import React, { useEffect, useMemo, useRef, useState } from "react";
import "./css/deprati.css";
import "primereact/resources/themes/lara-light-indigo/theme.css";
import "primereact/resources/primereact.min.css";
import "primeicons/primeicons.css";
import "primeflex/primeflex.css";

import * as XLSX from "xlsx";
import { Toast } from "primereact/toast";
import { ProgressSpinner } from "primereact/progressspinner";
import { DataTable } from "primereact/datatable";
import { Column } from "primereact/column";
import { Button } from "primereact/button";
import { Dialog } from "primereact/dialog";
import { InputText } from "primereact/inputtext";
import { InputNumber } from "primereact/inputnumber";
import { Dropdown } from "primereact/dropdown";
import { Card } from "primereact/card";
import { Toolbar } from "primereact/toolbar";
import { Divider } from "primereact/divider";
import { ConfirmDialog, confirmDialog } from "primereact/confirmdialog";

// ================= API base =================
// Tu controller: @RequestMapping("/api-sellout/rm")
const API_BASE = "/api-sellout/rm";

// Si quieres forzar siempre un codCliente desde frontend, ponlo aquí.
// Si lo dejas null, el backend usará DEFAULT_COD_CLIENTE = "MZCL-000008".
const COD_CLIENTE_FIJO = null; // "MZCL-000008";

const getFilenameFromCD = (cd) => {
  if (!cd) return null;
  const m = /filename\*=UTF-8''([^;\n]+)|filename=\"?([^\";\n]+)\"?/i.exec(cd);
  if (m) return decodeURIComponent((m[1] || m[2] || "").trim());
  return null;
};

async function apiFetch(
  path,
  { method = "GET", headers = {}, body, expect = "json", timeoutMs = 60000, signal } = {}
) {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: {
      ...(expect === "json" ? { Accept: "application/json" } : {}),
      ...headers,
    },
    body,
    signal: signal ?? AbortSignal.timeout(timeoutMs),
  });

  if (!res.ok) {
    let msg = "";
    try {
      const ct = res.headers.get("Content-Type") || "";
      // tu backend suele responder {ok:false, error:"..."} o texto
      if (ct.includes("application/json")) {
        const j = await res.json();
        msg = j?.error || j?.message || JSON.stringify(j);
      } else {
        msg = await res.text();
      }
    } catch {}
    const base =
      res.status === 404
        ? "No encontrado (404): endpoint inexistente."
        : res.status === 422
        ? "Datos inválidos (422)."
        : res.status >= 500
        ? `Error del servidor (${res.status})`
        : `Error HTTP (${res.status})`;
    throw new Error([base, msg && `Detalle: ${msg}`].filter(Boolean).join(" | "));
  }

  if (expect === "blob") {
    const blob = await res.blob();
    const filename = getFilenameFromCD(res.headers.get("Content-Disposition"));
    const contentType = res.headers.get("Content-Type") || "";
    return { blob, filename, contentType, res };
  }

  const ct = res.headers.get("Content-Type") || "";
  if (ct.includes("application/json")) {
    const data = await res.json();
    return { data, res };
  }
  const textFallback = await res.text();
  return { data: textFallback, res };
}

// ================= Utilidades =================
const monthNames = [
  "Enero","Febrero","Marzo","Abril","Mayo","Junio",
  "Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre",
];
const monthLabel = (m) => monthNames[(Number(m || 1) - 1)] || m;

const calculateUploadTime = (fileSize) => {
  const fileSizeMB = fileSize / (1024 * 1024);
  const uploadSpeedMBps = 0.5;
  const baseProcessingTime = 10000;
  const processingTimePerMB = 1000;
  const uploadTimeMs = (fileSizeMB / uploadSpeedMBps) * 1000;
  const processingTimeMs = baseProcessingTime + (fileSizeMB * processingTimePerMB);
  const totalEstimatedTime = (uploadTimeMs + processingTimeMs) * 1.5;
  return Math.min(Math.max(totalEstimatedTime, 15000), 900000);
};

const formatDuration = (ms) => {
  const totalSec = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  const ss = String(s).padStart(2, "0");
  return m <= 0 ? `${ss}s` : `${m}:${ss} min`;
};

const toInt = (v, def = 0) => {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() && !isNaN(Number(v))) return Number(v);
  return def;
};

const safeStr = (v) => (v == null ? "" : String(v));
const num = (v, def = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
};

const RM = () => {
  const toast = useRef(null);
  const fileInputRef = useRef(null);
  const abortRef = useRef(null);

  // data
  const [ventas, setVentas] = useState([]);
  const [loadingVentas, setLoadingVentas] = useState(false);

  // selection / edit
  const [selectedVentas, setSelectedVentas] = useState([]);
  const [editVenta, setEditVenta] = useState(null);
  const [isSaving, setIsSaving] = useState(false);

  // upload overlay
  const [loadingTemplate, setLoadingTemplate] = useState(false);
  const [uploadRemainingMs, setUploadRemainingMs] = useState(null);
  const [uploadElapsedMs, setUploadElapsedMs] = useState(0);
  const countdownRef = useRef(null);
  const elapsedRef = useRef(null);

  // filtros
  const [filterYear, setFilterYear] = useState(null);
  const [filterMonth, setFilterMonth] = useState(null);
  const [filterMarca, setFilterMarca] = useState("");
  const [globalFilter, setGlobalFilter] = useState("");

  const [yearsOptions, setYearsOptions] = useState([]);
  const [monthsOptions] = useState(
    Array.from({ length: 12 }, (_, i) => ({ label: monthLabel(i + 1), value: i + 1 }))
  );
  const [marcasOptions, setMarcasOptions] = useState([]);

  // ===== Toast helpers =====
  const showToast = ({ type = "info", summary, detail, life = 3500, content, sticky, className }) =>
    toast.current?.show({ severity: type, summary, detail, life, content, sticky, className });

  const showSuccess = (m) => showToast({ type: "success", summary: "Éxito", detail: m });
  const showInfo = (m) => showToast({ type: "info", summary: "Información", detail: m });
  const showWarn = (m) => showToast({ type: "warn", summary: "Advertencia", detail: m });
  const showError = (m) => showToast({ type: "error", summary: "Error", detail: m, life: 9000 });

  // ===== build query para GET /api-sellout/rm/ventas =====
  const buildVentasQuery = () => {
    const qs = new URLSearchParams();
    if (COD_CLIENTE_FIJO) qs.set("codCliente", COD_CLIENTE_FIJO);
    if (filterYear != null) qs.set("anio", String(filterYear));
    if (filterMonth != null) qs.set("mes", String(filterMonth));
    if (filterMarca) qs.set("marca", filterMarca);

    // OJO: tu controller acepta limit/offset pero actualmente NO los usa en rmService.obtenerVentasTodasPorCodCliente
    // Igual los dejamos por compatibilidad.
    qs.set("limit", "10000");
    qs.set("offset", "0");
    return qs.toString();
  };

  const loadVentas = async () => {
    setLoadingVentas(true);
    try {
      const qs = buildVentasQuery();
      const { data } = await apiFetch(`/ventas?${qs}`);
      const list = Array.isArray(data) ? data : [];
      setVentas(list);

      // options derivados
      const years = [...new Set(list.map((x) => toInt(x?.anio, null)).filter((n) => n))].sort((a, b) => a - b);
      setYearsOptions(years.map((y) => ({ label: String(y), value: y })));

      const marcas = [...new Set(list.map((x) => safeStr(x?.marca).trim()).filter(Boolean))].sort();
      setMarcasOptions(marcas.map((m) => ({ label: m, value: m })));
    } catch (e) {
      showError(String(e));
      setVentas([]);
      setYearsOptions([]);
      setMarcasOptions([]);
    } finally {
      setLoadingVentas(false);
    }
  };

  useEffect(() => {
    loadVentas();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    loadVentas();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterYear, filterMonth, filterMarca]);

  // ===== overlay timers =====
  useEffect(() => {
    if (uploadRemainingMs == null) return;
    if (countdownRef.current) clearInterval(countdownRef.current);
    countdownRef.current = setInterval(() => {
      setUploadRemainingMs((ms) => (ms == null ? null : Math.max(0, ms - 1000)));
    }, 1000);
    return () => {
      if (countdownRef.current) {
        clearInterval(countdownRef.current);
        countdownRef.current = null;
      }
    };
  }, [uploadRemainingMs]);

  useEffect(() => {
    if (!loadingTemplate) return;
    if (elapsedRef.current) clearInterval(elapsedRef.current);
    elapsedRef.current = setInterval(() => setUploadElapsedMs((ms) => ms + 1000), 1000);
    return () => {
      if (elapsedRef.current) {
        clearInterval(elapsedRef.current);
        elapsedRef.current = null;
      }
    };
  }, [loadingTemplate]);

  // ===== Import RM Excel =====
  const descargarTxtBackend = async (file) => {
    // Controller: POST /api-sellout/rm/subir-archivo-venta?txt=true
    // (txt es @RequestParam, se envía en query string)
    const formData = new FormData();
    formData.append("file", file);
    if (COD_CLIENTE_FIJO) formData.append("codCliente", COD_CLIENTE_FIJO);

    const { blob, filename, contentType } = await apiFetch(`/subir-archivo-venta?txt=true`, {
      method: "POST",
      body: formData,
      expect: "blob",
      timeoutMs: 15 * 60 * 1000,
    });

    const suggested =
      filename ||
      (contentType.includes("text/plain") ? "incidencias_RM.txt" : "incidencias_RM.bin");

    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = suggested;
    a.click();
    URL.revokeObjectURL(url);
  };

  const cargarExcelRM = async (file) => {
    if (!file) return showWarn("No seleccionaste ningún archivo.");
    const ext = file.name.split(".").pop().toLowerCase();
    if (!["xlsx", "xls"].includes(ext)) return showError("Tipo de archivo no soportado. Sube Excel (.xlsx o .xls).");

    setLoadingTemplate(true);
    setUploadElapsedMs(0);

    const estMs = calculateUploadTime(file.size);
    setUploadRemainingMs(estMs);

    toast.current?.show({
      severity: "info",
      summary: "Cargando archivo RM",
      detail: `Subiendo ${file.name}. ETA: ${formatDuration(estMs)}. Por favor espere...`,
      life: 0,
      sticky: true,
      className: "deprati-toast deprati-toast-info deprati-toast-persistent",
    });

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const formData = new FormData();
      formData.append("file", file);
      if (COD_CLIENTE_FIJO) formData.append("codCliente", COD_CLIENTE_FIJO);

      // Controller: POST /api-sellout/rm/subir-archivo-venta (JSON por defecto)
      const res = await fetch(`${API_BASE}/subir-archivo-venta`, {
        method: "POST",
        body: formData,
        signal: controller.signal,
      });

      if (!res.ok) {
        const ct = res.headers.get("Content-Type") || "";
        let msg = "";
        try {
          if (ct.includes("application/json")) {
            const j = await res.json();
            msg = j?.error || j?.message || JSON.stringify(j);
          } else {
            msg = await res.text();
          }
        } catch {}
        throw new Error(msg || `Error HTTP ${res.status}`);
      }

      const result = await res.json();

      if (toast.current) toast.current.clear();

      const ok = !!result?.ok;
      const filasLV = toInt(result?.filasLeidasVentas, 0);
      const filasPV = toInt(result?.filasProcesadasVentas, 0);
      const filasLS = toInt(result?.filasLeidasStock, 0);
      const filasPS = toInt(result?.filasProcesadasStock, 0);

      const noEncontrados = Array.isArray(result?.codigosNoEncontrados) ? result.codigosNoEncontrados : [];
      const incidencias = Array.isArray(result?.incidencias) ? result.incidencias : [];

      showToast({
        type: ok ? "success" : "warn",
        summary: ok ? "Carga RM completada" : "Carga RM con incidencias",
        sticky: true,
        className: "deprati-toast deprati-toast-info",
        content: (
          <div className="flex flex-column gap-2">
            <div>
              Ventas: leídas <b>{filasLV}</b> / procesadas <b>{filasPV}</b>
              <br />
              Stock: leídas <b>{filasLS}</b> / procesadas <b>{filasPS}</b>
              <br />
              No encontrados: <b>{noEncontrados.length}</b> | Incidencias: <b>{incidencias.length}</b>
            </div>

            <div className="flex gap-2 flex-wrap">
              <Button
                label="Descargar TXT (backend)"
                icon="pi pi-download"
                className="p-button-sm p-button-warning"
                onClick={async () => {
                  try {
                    await descargarTxtBackend(file);
                    showSuccess("TXT descargado.");
                  } catch (e) {
                    showError(String(e));
                  }
                }}
              />
              <Button
                label="Refrescar tabla"
                icon="pi pi-refresh"
                className="p-button-sm p-button-help"
                onClick={loadVentas}
              />
            </div>
          </div>
        ),
      });

      await loadVentas();
    } catch (e) {
      if (toast.current) toast.current.clear();
      if (e?.name === "AbortError") showError("Carga cancelada o abortada.");
      else showError(String(e?.message || e));
    } finally {
      setUploadRemainingMs(null);
      setTimeout(() => setLoadingTemplate(false), 900);
      abortRef.current = null;

      if (countdownRef.current) {
        clearInterval(countdownRef.current);
        countdownRef.current = null;
      }
      if (elapsedRef.current) {
        clearInterval(elapsedRef.current);
        elapsedRef.current = null;
      }
    }
  };

  // ===== CRUD =====
  // IMPORTANTE: Tu /ventas devuelve "resumen" (Map). Para editar bien, primero pedimos el entity con GET /venta/{id}
  const openEdit = async (row) => {
    try {
      const qs = new URLSearchParams();
      if (COD_CLIENTE_FIJO) qs.set("codCliente", COD_CLIENTE_FIJO);

      const { data } = await apiFetch(`/venta/${row.id}?${qs.toString()}`);
      setEditVenta(data);
    } catch (e) {
      showError(String(e));
    }
  };

  const actualizarVenta = async () => {
    if (!editVenta?.id) return;
    setIsSaving(true);
    try {
      const qs = new URLSearchParams();
      if (COD_CLIENTE_FIJO) qs.set("codCliente", COD_CLIENTE_FIJO);

      await apiFetch(`/venta/${editVenta.id}?${qs.toString()}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editVenta),
        timeoutMs: 60000,
      });

      showSuccess("Venta actualizada correctamente");
      setEditVenta(null);
      await loadVentas();
    } catch (e) {
      showError(String(e));
    } finally {
      setIsSaving(false);
    }
  };

  const eliminarVenta = (id) => {
    confirmDialog({
      message: "¿Está seguro de eliminar esta venta?",
      header: "Confirmación de eliminación",
      icon: "pi pi-exclamation-triangle",
      acceptLabel: "Sí, eliminar",
      rejectLabel: "No, cancelar",
      acceptClassName: "p-button-danger",
      closable: false,
      accept: async () => {
        try {
          const qs = new URLSearchParams();
          if (COD_CLIENTE_FIJO) qs.set("codCliente", COD_CLIENTE_FIJO);

          await apiFetch(`/venta/${id}?${qs.toString()}`, { method: "DELETE", timeoutMs: 60000 });
          showSuccess("Venta eliminada correctamente");
          await loadVentas();
        } catch (e) {
          showError(String(e));
        }
      },
    });
  };

  const eliminarVentasSeleccionadas = () => {
    if (!selectedVentas.length) return showInfo("No hay ventas seleccionadas.");

    confirmDialog({
      message: `¿Está seguro de eliminar ${selectedVentas.length} venta(s)?`,
      header: "Confirmación de eliminación masiva",
      icon: "pi pi-exclamation-triangle",
      acceptLabel: "Sí, eliminar",
      rejectLabel: "No, cancelar",
      acceptClassName: "p-button-danger",
      closable: false,
      accept: async () => {
        try {
          const ids = selectedVentas.map((v) => v.id).filter(Boolean).slice(0, 5000);

          const qs = new URLSearchParams();
          if (COD_CLIENTE_FIJO) qs.set("codCliente", COD_CLIENTE_FIJO);

          await apiFetch(`/ventas-forma-masiva?${qs.toString()}`, {
            method: "DELETE",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(ids),
            timeoutMs: 120000,
          });

          showSuccess("Ventas eliminadas correctamente");
          setSelectedVentas([]);
          await loadVentas();
        } catch (e) {
          showError(String(e));
        }
      },
    });
  };

  // ===== tabla filtrada local (solo search global) =====
  const filteredData = useMemo(() => {
    let base = [...ventas];
    const gf = globalFilter?.trim();
    if (gf) {
      const lowered = gf.toLowerCase();
      base = base.filter((item) =>
        Object.values(item || {}).some((val) =>
          safeStr(val).toLowerCase().includes(lowered)
        )
      );
    }
    return base;
  }, [ventas, globalFilter]);

  // ===== Export =====
  const exportFilteredToExcel = () => {
    if (!filteredData.length) return showWarn("No hay datos para exportar.");

    const exportData = filteredData.map((v) => ({
      "ID": v.id,
      "Año": v.anio,
      "Mes": monthLabel(v.mes),
      "Día": v.dia,
      "Marca": v.marca,
      "Producto": v.nombreProducto,
      "Código Barra": v.codBarra,
      "Código SAP": v.codigoSap,
      "Descripción": v.descripcion,
      "Cod PDV": v.codPdv,
      "PDV": v.pdv,
      "Ciudad": v.ciudad,
      "Stock ($)": num(v.stockDolares, 0),
      "Stock (U)": num(v.stockUnidades, 0),
      "Venta ($)": num(v.ventaDolares, 0),
      "Venta (U)": num(v.ventaUnidad, 0),
      "Cod Cliente": v.codCliente,
      "Cliente": v.nombreCliente,
    }));

    const ws = XLSX.utils.json_to_sheet(exportData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "RM Filtradas");

    const now = new Date();
    const fechaStr = now.toISOString().slice(0, 10);
    XLSX.writeFile(wb, `Reporte_RM_${fechaStr}.xlsx`);
    showSuccess(`Reporte generado con ${exportData.length} registros.`);
  };

  // ===== UI =====
  const renderHeader = () => (
    <div className="deprati-table-header flex flex-wrap gap-2 align-items-center justify-content-between">
      <h4 className="deprati-title m-0">Gestión de Ventas RM</h4>
      <span className="deprati-search p-input-icon-left">
        <i className="pi pi-search" />
        <InputText
          value={globalFilter}
          onChange={(e) => setGlobalFilter(e.target.value || "")}
          placeholder="Buscar..."
          className="deprati-search-input"
        />
      </span>
    </div>
  );

  const leftToolbarTemplate = () => (
    <div className="deprati-toolbar-left flex flex-wrap align-items-center gap-3">
      <Button
        label="Importar Excel"
        icon="pi pi-file-excel"
        className="p-button-primary p-button-raised"
        onClick={() => fileInputRef.current?.click()}
      />
      <input
        ref={fileInputRef}
        type="file"
        accept=".xlsx,.xls"
        style={{ display: "none" }}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) cargarExcelRM(f);
          e.target.value = "";
        }}
      />

      <Button
        label="Eliminar Seleccionados"
        icon="pi pi-trash"
        className="p-button-danger"
        disabled={!selectedVentas.length}
        onClick={eliminarVentasSeleccionadas}
      />
    </div>
  );

  const rightToolbarTemplate = () => (
    <div className="deprati-toolbar-right flex flex-wrap align-items-center gap-3">
      <Button
        label="Exportar Filtrados"
        icon="pi pi-file-excel"
        className="p-button-success p-button-raised"
        onClick={exportFilteredToExcel}
        disabled={!filteredData.length}
      />
      <Button
        label="Refrescar"
        icon="pi pi-refresh"
        className="p-button-help p-button-raised"
        onClick={loadVentas}
        disabled={loadingVentas}
      />
    </div>
  );

  const actionBodyTemplate = (row) => (
    <div className="deprati-row-actions flex gap-2 justify-content-center">
      <Button
        icon="pi pi-pencil"
        className="p-button-rounded p-button-outlined p-button-info"
        onClick={() => openEdit(row)}
        tooltip="Editar"
        aria-label="Editar"
      />
      <Button
        icon="pi pi-trash"
        className="p-button-rounded p-button-outlined p-button-danger"
        onClick={() => eliminarVenta(row.id)}
        tooltip="Eliminar"
        aria-label="Eliminar"
      />
    </div>
  );

  return (
    <div className="deprati-layout-wrapper">
      <Toast ref={toast} position="top-right" className="toast-on-top" />
      <ConfirmDialog />

      {/* Overlay de carga */}
      {loadingTemplate && (
        <div className="fixed top-0 left-0 w-full h-full flex justify-content-center align-items-center bg-black-alpha-70 z-5">
          <div
            className="surface-card p-5 border-round shadow-2 text-center"
            style={{ minWidth: 360, backgroundColor: "rgba(0,0,0,0.85)" }}
          >
            <ProgressSpinner style={{ width: "60px", height: "60px" }} />
            <div className="mt-3" style={{ fontWeight: "bold", color: "white", fontSize: "1.2rem" }}>
              Procesando archivo RM...
            </div>

            <div className="mt-2" style={{ fontSize: "1rem", color: "white", fontWeight: "bold" }}>
              {uploadRemainingMs != null ? (
                <>
                  Tiempo restante estimado:&nbsp;
                  <span style={{ fontFamily: "monospace", fontWeight: "bold", color: "white" }}>
                    {formatDuration(uploadRemainingMs)}
                  </span>
                </>
              ) : (
                <span style={{ color: "white", fontWeight: "bold" }}>Calculando tiempo estimado...</span>
              )}
            </div>

            <div className="mt-2" style={{ fontSize: "1rem", color: "white", fontWeight: "bold" }}>
              Tiempo transcurrido:&nbsp;
              <span style={{ fontFamily: "monospace", fontWeight: "bold", color: "white" }}>
                {formatDuration(uploadElapsedMs)}
              </span>
            </div>

            <div className="mt-3">
              <Button
                label="Cancelar"
                icon="pi pi-times"
                className="p-button-text p-button-danger"
                onClick={() => {
                  abortRef.current?.abort?.();
                  if (toast.current) toast.current.clear();
                  showInfo("Carga cancelada por el usuario");
                }}
              />
            </div>
          </div>
        </div>
      )}

      <div className="deprati-card card">
        <h1 className="deprati-main-title text-center text-primary my-4">Ventas RM</h1>

        <Toolbar className="deprati-toolbar mb-4" left={leftToolbarTemplate} right={rightToolbarTemplate} />

        <Card className="deprati-filter-card mb-4">
          <h3 className="deprati-section-title text-primary mb-3">Filtros</h3>

          <div className="grid formgrid">
            <div className="flex flex-wrap gap-8 align-items-end">
              <div className="field">
                <label className="deprati-label font-bold block mb-2">Año</label>
                <Dropdown
                  value={filterYear}
                  options={yearsOptions}
                  onChange={(e) => setFilterYear(e.value ?? null)}
                  placeholder="Seleccionar Año"
                  className="deprati-dropdown w-12rem"
                  showClear
                />
              </div>

              <div className="field">
                <label className="deprati-label font-bold block mb-2">Mes</label>
                <Dropdown
                  value={filterMonth}
                  options={monthsOptions}
                  onChange={(e) => setFilterMonth(e.value ?? null)}
                  placeholder="Seleccionar Mes"
                  className="deprati-dropdown w-12rem"
                  showClear
                />
              </div>

              <div className="field">
                <label className="deprati-label font-bold block mb-2">Marca</label>
                <Dropdown
                  value={filterMarca}
                  options={marcasOptions}
                  onChange={(e) => setFilterMarca(e.value ?? "")}
                  placeholder="Seleccionar Marca"
                  className="deprati-dropdown w-16rem"
                  showClear
                  filter
                />
              </div>
            </div>
          </div>

          <Divider className="deprati-divider" />
          <div className="deprati-filter-actions flex justify-content-end gap-3 mt-3">
            <Button
              label="Limpiar Filtros"
              icon="pi pi-times"
              onClick={() => {
                setFilterYear(null);
                setFilterMonth(null);
                setFilterMarca("");
                setGlobalFilter("");
              }}
              className="p-button-raised p-button-outlined deprati-button deprati-button-clear"
            />
          </div>
        </Card>

        <div className="card">
          <DataTable
            value={filteredData}
            dataKey="id"
            paginator
            rows={50}
            rowsPerPageOptions={[50, 100, 200]}
            responsiveLayout="scroll"
            stripedRows
            showGridlines
            header={renderHeader}
            emptyMessage="No se encontraron registros"
            loading={loadingVentas}
            selection={selectedVentas}
            onSelectionChange={(e) => {
              const value = e.value || [];
              if (value.length > 5000) {
                showWarn("Solo puede seleccionar un máximo de 5000 registros.");
                setSelectedVentas(value.slice(0, 5000));
              } else {
                setSelectedVentas(value);
              }
            }}
          >
            <Column selectionMode="multiple" headerStyle={{ width: "3rem" }} />
            <Column field="anio" header="Año" sortable />
            <Column field="mes" header="Mes" sortable />
            <Column field="dia" header="Día" sortable />
            <Column field="marca" header="Marca" sortable />
            <Column field="codPdv" header="Código PDV" sortable />
            <Column field="pdv" header="PDV" sortable />
            <Column field="ciudad" header="Ciudad" sortable />
            <Column field="nombreProducto" header="Producto" sortable style={{ minWidth: "18rem" }} />
            <Column field="codBarra" header="Código Barra" sortable />
            <Column field="codigoSap" header="Código SAP" sortable />
            <Column
              field="stockDolares"
              header="Stock ($)"
              sortable
              body={(r) => num(r?.stockDolares, 0).toFixed(2)}
            />
            <Column
              field="stockUnidades"
              header="Stock (U)"
              sortable
              body={(r) => num(r?.stockUnidades, 0).toFixed(0)}
            />
            <Column
              field="ventaDolares"
              header="Venta ($)"
              sortable
              body={(r) => num(r?.ventaDolares, 0).toFixed(2)}
            />
            <Column
              field="ventaUnidad"
              header="Venta (U)"
              sortable
              body={(r) => num(r?.ventaUnidad, 0).toFixed(0)}
            />
            <Column body={actionBodyTemplate} exportable={false} header="Acciones" />
          </DataTable>
        </div>

        {/* Dialog editar */}
        <Dialog
          visible={editVenta !== null}
          onHide={() => setEditVenta(null)}
          header="Editar Venta RM"
          className="deprati-edit-dialog p-fluid"
          style={{ width: "65vw", maxWidth: "1100px" }}
          modal
          dismissableMask
        >
          <div className="p-3">
            <div className="grid formgrid p-fluid">
              <div className="col-12 md:col-4">
                <span className="p-float-label">
                  <InputNumber
                    id="anio"
                    value={editVenta?.anio}
                    onValueChange={(e) => setEditVenta((x) => ({ ...x, anio: e.value }))}
                    useGrouping={false}
                  />
                  <label htmlFor="anio">Año</label>
                </span>
              </div>

              <div className="col-12 md:col-4">
                <span className="p-float-label">
                  <InputNumber
                    id="mes"
                    value={editVenta?.mes}
                    onValueChange={(e) => setEditVenta((x) => ({ ...x, mes: e.value }))}
                    useGrouping={false}
                    min={1}
                    max={12}
                  />
                  <label htmlFor="mes">Mes</label>
                </span>
              </div>

              <div className="col-12 md:col-4">
                <span className="p-float-label">
                  <InputNumber
                    id="dia"
                    value={editVenta?.dia}
                    onValueChange={(e) => setEditVenta((x) => ({ ...x, dia: e.value }))}
                    useGrouping={false}
                    min={1}
                    max={31}
                  />
                  <label htmlFor="dia">Día</label>
                </span>
              </div>

              <div className="col-12 md:col-6 mt-3">
                <span className="p-float-label">
                  <InputText
                    id="marca"
                    value={editVenta?.marca || ""}
                    onChange={(e) => setEditVenta((x) => ({ ...x, marca: e.target.value }))}
                  />
                  <label htmlFor="marca">Marca</label>
                </span>
              </div>

              <div className="col-12 md:col-6 mt-3">
                <span className="p-float-label">
                  <InputText
                    id="nombreProducto"
                    value={editVenta?.nombreProducto || ""}
                    onChange={(e) => setEditVenta((x) => ({ ...x, nombreProducto: e.target.value }))}
                  />
                  <label htmlFor="nombreProducto">Producto</label>
                </span>
              </div>

              <div className="col-12 md:col-6 mt-3">
                <span className="p-float-label">
                  <InputText
                    id="codBarra"
                    value={editVenta?.codBarra || ""}
                    onChange={(e) => setEditVenta((x) => ({ ...x, codBarra: e.target.value }))}
                  />
                  <label htmlFor="codBarra">Código Barra</label>
                </span>
              </div>

              <div className="col-12 md:col-6 mt-3">
                <span className="p-float-label">
                  <InputText
                    id="codPdv"
                    value={editVenta?.codPdv || ""}
                    onChange={(e) => setEditVenta((x) => ({ ...x, codPdv: e.target.value }))}
                  />
                  <label htmlFor="codPdv">Código PDV</label>
                </span>
              </div>

              <div className="col-12 md:col-4 mt-3">
                <span className="p-float-label">
                  <InputNumber
                    id="stockDolares"
                    value={editVenta?.stockDolares ?? 0}
                    onValueChange={(e) => setEditVenta((x) => ({ ...x, stockDolares: e.value }))}
                    mode="decimal"
                    minFractionDigits={2}
                  />
                  <label htmlFor="stockDolares">Stock ($)</label>
                </span>
              </div>

              <div className="col-12 md:col-4 mt-3">
                <span className="p-float-label">
                  <InputNumber
                    id="stockUnidades"
                    value={editVenta?.stockUnidades ?? 0}
                    onValueChange={(e) => setEditVenta((x) => ({ ...x, stockUnidades: e.value }))}
                    useGrouping={false}
                  />
                  <label htmlFor="stockUnidades">Stock (U)</label>
                </span>
              </div>

              <div className="col-12 md:col-4 mt-3">
                <span className="p-float-label">
                  <InputNumber
                    id="ventaDolares"
                    value={editVenta?.ventaDolares ?? 0}
                    onValueChange={(e) => setEditVenta((x) => ({ ...x, ventaDolares: e.value }))}
                    mode="decimal"
                    minFractionDigits={2}
                  />
                  <label htmlFor="ventaDolares">Venta ($)</label>
                </span>
              </div>

              <div className="col-12 md:col-4 mt-3">
                <span className="p-float-label">
                  <InputNumber
                    id="ventaUnidad"
                    value={editVenta?.ventaUnidad ?? 0}
                    onValueChange={(e) => setEditVenta((x) => ({ ...x, ventaUnidad: e.value }))}
                    useGrouping={false}
                  />
                  <label htmlFor="ventaUnidad">Venta (U)</label>
                </span>
              </div>
            </div>

            <div className="flex justify-content-end gap-2 mt-4">
              <Button
                label="Cancelar"
                icon="pi pi-times"
                className="p-button-outlined p-button-secondary"
                onClick={() => setEditVenta(null)}
                type="button"
              />
              <Button
                label={isSaving ? "Guardando..." : "Guardar"}
                icon={isSaving ? "pi pi-spin pi-spinner" : "pi pi-check"}
                className="p-button-primary"
                onClick={actualizarVenta}
                disabled={isSaving}
                type="button"
              />
            </div>
          </div>
        </Dialog>
      </div>
    </div>
  );
};

export default RM;
