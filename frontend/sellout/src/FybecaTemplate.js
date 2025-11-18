import React, { useEffect, useMemo, useRef, useState } from "react";
import "./css/deprati.css";
import "primereact/resources/themes/lara-light-indigo/theme.css";
import "primereact/resources/primereact.min.css";
import "primeicons/primeicons.css";
import "primeflex/primeflex.css";

import * as XLSX from "xlsx";
import { Toast } from "primereact/toast";
import { ProgressSpinner } from "primereact/progressspinner";
import { Calendar } from "primereact/calendar";
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

// ================= API base y helper fetch =================
const API_BASE = "/api-sellout/fybeca";

const getFilenameFromCD = (cd) => {
  if (!cd) return null;
  const m = /filename\\*=UTF-8''([^;\\n]+)|filename=\\"?([^\\\";\\n]+)\\"?/i.exec(cd);
  if (m) return decodeURIComponent((m[1] || m[2] || "").trim());
  return null;
};

const COD_CLIENTE_FIJO = "MZCL-000014"; // filtrar/forzar siempre por este codCliente

async function apiFetch(
  path,
  { method = "GET", headers = {}, body, expect = "json", timeoutMs = 60000 } = {}
) {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: {
      ...(expect === "json" ? { Accept: "application/json" } : {}),
      ...headers,
    },
    body,
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!res.ok) {
    let msg = "";
    try {
      const ct = res.headers.get("Content-Type") || "";
      msg = ct.includes("application/json") ? (await res.json())?.message : await res.text();
    } catch {}
    const base =
      res.status === 404
        ? "No encontrado (404): recurso o endpoint inexistente."
        : res.status === 422
        ? "Datos inválidos (422): el archivo contiene filas o formatos no válidos."
        : res.status >= 500
        ? `Error del servidor (${res.status})`
        : `Error HTTP (${res.status})`;
    const corr = res.headers.get("X-Error-Id") || res.headers.get("X-Correlation-Id");
    throw new Error(
      [base, msg && `Detalle: ${msg}`, corr && `Correlation-Id: ${corr}`]
        .filter(Boolean)
        .join(" | ")
    );
  }

  if (expect === "blob") {
    const blob = await res.blob();
    const filename = getFilenameFromCD(res.headers.get("Content-Disposition"));
    const contentType = res.headers.get("Content-Type") || "";
    return { blob, filename, contentType };
  }

  if (expect === "text") {
    const text = await res.text();
    return { text };
  }

  const ct = res.headers.get("Content-Type") || "";
  if (ct.includes("application/json")) {
    const data = await res.json();
    return { data };
  }
  const textFallback = await res.text();
  return { data: textFallback };
}

// ================= Utilidades de mes =================
const monthNames = [
  "Enero","Febrero","Marzo","Abril","Mayo","Junio",
  "Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre",
];
const monthLabel = (m) => monthNames[(Number(m || 1) - 1)] || m;

// ================= Helpers de Incidencias / Log TXT =================
const TXT_HEADER = "CODIGOS_NO_ENCONTRADOS";

// Normaliza arrays de errores en distintas formas a: [{codigo, motivo}]
const normalizeErrores = (result) => {
  const toObj = (x, motivoFallback = "Motivo no especificado") =>
    typeof x === "object"
      ? ({
          codigo: x.codigo ?? x.cod ?? x.code ?? x.id ?? "N/D",
          motivo: x.motivo ?? x.error ?? x.mensaje ?? motivoFallback,
        })
      : ({ codigo: String(x), motivo: motivoFallback });

  if (Array.isArray(result?.codigosNoEncontrados)) {
    const arr = result.codigosNoEncontrados;
    return arr.map((x) => toObj(x, "No se pudo mapear el código"));
  }
  if (Array.isArray(result?.errores)) {
    return result.errores.map((x) => toObj(x, "Motivo no especificado"));
  }
  if (Array.isArray(result?.itemsFallidos)) {
    return result.itemsFallidos.map((x) => toObj(x, "Motivo no especificado"));
  }
  if (Array.isArray(result)) {
    return result.map((x) => toObj(x, "Motivo no especificado"));
  }
  if (Array.isArray(result?.lista)) {
    return result.lista.map((c) => ({
      codigo: String(c),
      motivo: result?.motivo ?? "Motivo no especificado",
    }));
  }
  return [];
};

// Extrae contadores de filas desde un JSON flexible
const extractCounts = (result) => {
  const r = result || {};
  const possible = (obj, keys, def = 0) => {
    for (const k of keys) {
      const v = obj?.[k];
      if (typeof v === "number" && Number.isFinite(v)) return v;
      if (typeof v === "string" && v.trim() && !isNaN(Number(v))) return Number(v);
    }
    return def;
  };

  const src = r.resumen ?? r.summary ?? r.stats ?? r;

  const insertadas = possible(src, [
    "filasInsertadas","insertadas","inserted","inserts","created"
  ]);
  const actualizadas = possible(src, [
    "filasActualizadas","actualizadas","updated","updates","upserts"
  ]);
  const ignoradas = possible(src, [
    "filasIgnoradas","ignoradas","skipped","omitidas"
  ]);
  const conError = possible(src, [
    "filasConError","errores","withErrors","failed","fallidas"
  ]);
  let total = possible(src, ["total","filas","totalFilas","rows","processed"]);
  if (!total) total = insertadas + actualizadas + ignoradas + conError;

  // también soporta campos directos
  const filasLeidas = src?.filasLeidas ?? r?.filasLeidas ?? "N/D";

  return { insertadas, actualizadas, ignoradas, conError, total, filasLeidas };
};

// Construye el contenido del TXT de incidencias "simple"
const buildTxtFromErrores = (errores) => {
  const lines = [TXT_HEADER];
  errores.forEach(({ codigo, motivo }) => {
    lines.push(`(el codigo : ${codigo}) - ${motivo || "Motivo no especificado"}`);
  });
  return lines.join("\\n");
};

// ===== Helpers para TXT de incidencias extendido =====
const z2 = (n) => String(n).padStart(2, "0");
const formatHHMMSS = (ms) => {
  const total = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${z2(h)}:${z2(m)}:${z2(s)}`;
};
const formatLocaleDateParts = (d) => {
  const fecha = d.toLocaleDateString();
  const hora = d.toLocaleTimeString();
  return { fecha, hora };
};
const buildIncidenciasFybecaText = ({
  fileName,
  fileSizeBytes,
  estMs,
  elapsedMs,
  startDate,
  endDate,
  filasLeidas = "N/D",
  filasProcesadas = "N/D",
  insertadas = 0,
  actualizadas = 0,
  ignoradas = 0,
  conError = 0,
  codigosExitosos = 0,
  errores = [],
}) => {
  const sizeMB = (fileSizeBytes / (1024 * 1024));
  const { fecha } = formatLocaleDateParts(startDate);
  const { hora: horaInicio } = formatLocaleDateParts(startDate);
  const { hora: horaFin } = formatLocaleDateParts(endDate);
  const etaHHMMSS = formatHHMMSS(estMs);
  const realHHMMSS = formatHHMMSS(elapsedMs);

  const header = [
    "==== INCIDENCIAS DE CARGA — VENTAS FYBECA ====",
    `Fecha: ${fecha}`,
    `Hora inicio: ${horaInicio}`,
    `Hora fin: ${horaFin}`,
    `Archivo: ${fileName || "N/D"}`,
    `Tamaño: ${sizeMB.toFixed(2)} MB (${fileSizeBytes} bytes)`,
    `ETA (estimado): ${etaHHMMSS} (${Math.round(estMs)} ms)`,
    `Tiempo real: ${realHHMMSS} (${Math.round(elapsedMs)} ms)`,
    `Filas leídas: ${filasLeidas}`,
    `Filas procesadas: ${filasProcesadas}`,
    `Insertadas: ${insertadas}`,
    `Actualizadas: ${actualizadas}`,
    `Ignoradas: ${ignoradas}`,
    `Con error: ${conError}`,
    `Códigos exitosos: ${codigosExitosos}`,
    `Códigos no encontrados: ${errores.length}`,
    "",
    "---- DETALLE ERRORES / NO ENCONTRADOS ----",
  ].join("\\n");

  const body = (errores && errores.length)
    ? errores.map(({ codigo, motivo }) => `(el codigo : ${codigo}) - ${motivo || "No se pudo mapear el código"}`).join("\\n")
    : "(sin incidencias)";

  const footer = "\\n\\n==============================================\\n";

  return header + "\\n" + body + footer;
};

// Guardar contenido de texto
const saveTextFile = async (contenido, suggestedName = "log.txt") => {
  try {
    if (!window.showSaveFilePicker) {
      const blob = new Blob([contenido], { type: "text/plain;charset=utf-8" });
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = suggestedName;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      return true;
    }

    const handle = await window.showSaveFilePicker({
      suggestedName,
      types: [{ description: "Archivo de texto", accept: { "text/plain": [".txt"] } }],
    });
    const writable = await handle.createWritable();
    await writable.write(contenido);
    await writable.close();
    return true;
  } catch (e) {
    if (e?.name === "AbortError") return false;
    throw e;
  }
};

// ===== Tiempo de carga estilo Deprati =====
const calculateUploadTime = (fileSize) => {
  const fileSizeMB = fileSize / (1024 * 1024);
  const uploadSpeedMBps = 0.5; // estimación conservadora
  const baseProcessingTime = 10000; // 10s
  const processingTimePerMB = 1000; // 1s por MB
  const uploadTimeMs = (fileSizeMB / uploadSpeedMBps) * 1000;
  const processingTimeMs = baseProcessingTime + (fileSizeMB * processingTimePerMB);
  const totalEstimatedTime = (uploadTimeMs + processingTimeMs) * 1.5; // 1.5x colchón
  return Math.min(Math.max(totalEstimatedTime, 15000), 900000);
};
const formatDuration = (ms) => {
  const totalSec = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  const ss = String(s).padStart(2, "0");
  return m <= 0 ? `${ss}s` : `${m}:${ss} min`;
};

// === NUEVO: contar filas leídas en el Excel local antes de subir ===
const countRowsInExcel = (file) =>
  new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target.result);
        const wb = XLSX.read(data, { type: "array" });
        const wsname = wb.SheetNames[0];
        const ws = wb.Sheets[wsname];
        const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false });
        const count = rows.filter((r) => Array.isArray(r) && r.some((c) => (c !== null && c !== undefined && String(c).trim() !== ""))).length;
        resolve(Math.max(0, count - 1)); // restar cabecera
      } catch {
        resolve("N/D");
      }
    };
    reader.onerror = () => resolve("N/D");
    reader.readAsArrayBuffer(file);
  });

const Fybeca = () => {
  // === Refs ===
  const toast = useRef(null);
  const fileInputRef = useRef(null);
  const abortRef = useRef(null);

  // === State: data ===
  const [ventas, setVentas] = useState([]);
  const [ventasBase, setVentasBase] = useState([]);
  const [loadingVentas, setLoadingVentas] = useState(false);
  const [selectedVentas, setSelectedVentas] = useState([]);
  const [editVenta, setEditVenta] = useState(null);
  const [loadingTemplate, setLoadingTemplate] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  // Timers upload
  const [uploadRemainingMs, setUploadRemainingMs] = useState(null);
  const [uploadElapsedMs, setUploadElapsedMs] = useState(0);
  const countdownRef = useRef(null);
  const elapsedRef = useRef(null);

  // === State: filters (draft + applied) ===
  const [marcas, setMarcas] = useState([]);
  const [yearsOptions, setYearsOptions] = useState([]);
  const [monthsOptions, setMonthsOptions] = useState([]);

  const [filterYear, setFilterYear] = useState(null);
  const [filterMonth, setFilterMonth] = useState(null);
  const [filterMarca, setFilterMarca] = useState("");
  const [filterDate, setFilterDate] = useState(null);
  const [globalFilter, setGlobalFilter] = useState("");

  const [appliedFilters, setAppliedFilters] = useState({ year: null, month: null, marca: "", date: null });

  // Mostrar todo tras limpiar filtros
  const [showAll, setShowAll] = useState(false);

  // === Paginator ===
  const [paginatorState, setPaginatorState] = useState({ first: 0, rows: 10, page: 0, totalRecords: 0 });

  // === Toast helpers ===
  const showToast = ({ type = "info", summary, detail, life = 3500, content, sticky, className }) =>
    toast.current?.show({ severity: type, summary, detail, life, content, sticky, className });
  const showSuccess = (m) => showToast({ type: "success", summary: "Éxito", detail: m });
  const showInfo = (m) => showToast({ type: "info", summary: "Información", detail: m });
  const showWarn = (m) => showToast({ type: "warn", summary: "Advertencia", detail: m });
  const showError = (m) => showToast({ type: "error", summary: "Error", detail: m, life: 8000 });

  // === Loads base ===
  const loadMarcas = async () => {
    try {
      const { data } = await apiFetch("/marcas-ventas");
      setMarcas(Array.isArray(data) ? data : []);
    } catch (e) {
      showError(String(e));
    }
  };

  const loadYearsOptions = async () => {
    try {
      const { data } = await apiFetch("/anios-disponibles");
      const opts = (data || [])
        .map((y) => {
          const n = Number(typeof y === "object" ? y?.anio ?? y?.year ?? y?.value : y);
          return { label: String(n), value: Number.isFinite(n) ? n : null };
        })
        .filter((o) => o.value !== null)
        .sort((a, b) => a.value - b.value);
      setYearsOptions(opts);
    } catch (e) {
      const years = [...new Set(ventasBase.map((v) => v.anio))].filter(Number.isFinite).sort((a, b) => a - b);
      setYearsOptions(years.map((y) => ({ label: String(y), value: y })));
      showWarn("No se pudieron cargar los años desde API. Se usaron años del dataset.");
    }
  };

  const loadMonthsOptions = async (anio) => {
    if (anio == null || !Number.isFinite(anio)) {
      setMonthsOptions([]);
      return;
    }
    try {
      const qs = new URLSearchParams();
      qs.set("anio", String(anio));
      const { data } = await apiFetch(`/meses-disponibles?${qs.toString()}`);
      const raw = Array.isArray(data) ? data : [];
      const months = raw
        .map((item) => {
          const m = Number(
            typeof item === "object" ? item?.mes ?? item?.month ?? item?.value : item
          );
          return Number.isFinite(m) ? m : null;
        })
        .filter((m) => m && m >= 1 && m <= 12)
        .sort((a, b) => a - b);
      const opts = (months.length ? months : Array.from({ length: 12 }, (_, i) => i + 1)).map(
        (m) => ({ label: monthLabel(m), value: m })
      );
      setMonthsOptions(opts);
    } catch (e) {
      const months = [
        ...new Set(ventasBase.filter((v) => v.anio === anio).map((v) => v.mes)),
      ]
        .filter((m) => Number.isFinite(m) && m >= 1 && m <= 12)
        .sort((a, b) => a - b);
      const opts = (months.length ? months : Array.from({ length: 12 }, (_, i) => i + 1)).map(
        (m) => ({ label: monthLabel(m), value: m })
      );
      setMonthsOptions(opts);
      showInfo(
        months.length
          ? `Se encontraron ${months.length} meses con datos para el año ${anio}.`
          : `No hay datos para el año ${anio}. Se muestran todos los meses.`
      );
    }
  };

  const loadVentas = async () => {
    setLoadingVentas(true);
    try {
      const { data } = await apiFetch(`/venta?codCliente=${encodeURIComponent(COD_CLIENTE_FIJO)}`);
      const list = (Array.isArray(data) ? data : []).map((v) =>
        v?.cliente?.ciudad ? { ...v, ciudad: v.cliente.ciudad } : v
      );
      list._fromApi = true;
      setVentas(list);
      setVentasBase(list);
      setPaginatorState((p) => ({ ...p, first: 0, page: 0, totalRecords: list.length }));
    } catch (e) {
      showError("Error al cargar ventas");
      setVentas([]);
      setVentasBase([]);
      setPaginatorState((p) => ({ ...p, first: 0, page: 0, totalRecords: 0 }));
    } finally {
      setLoadingVentas(false);
    }
  };

  // ===== helper filtros =====
  const hasAnyApplied = useMemo(
    () =>
      appliedFilters.year !== null ||
      appliedFilters.month !== null ||
      !!appliedFilters.marca ||
      !!appliedFilters.date,
    [appliedFilters]
  );

  const showAny = useMemo(
    () => hasAnyApplied || (globalFilter?.trim()?.length > 0) || showAll,
    [hasAnyApplied, globalFilter, showAll]
  );

  const buildQuery = (f) => {
    const params = new URLSearchParams();
    if (f.year !== null) params.set("anio", String(f.year));
    if (f.month !== null) params.set("mes", String(f.month));
    if (f.marca) params.set("marca", f.marca);
    if (f.date) {
      const d = new Date(f.date);
      const yyyy = d.getFullYear();
      const mm = String(d.getMonth() + 1).padStart(2, "0");
      const dd = String(d.getDate()).padStart(2, "0");
      params.set("fecha", `${yyyy}-${mm}-${dd}`);
    }
    params.set("codCliente", COD_CLIENTE_FIJO);
    return params.toString();
  };

  const filterLocalData = (data, f) => {
    return data.filter((item) => {
      if ((item?.cliente?.codCliente || "").trim() !== COD_CLIENTE_FIJO) return false;
      if (f.year !== null && Number(item.anio) !== Number(f.year)) return false;
      if (f.month !== null && Number(item.mes) !== Number(f.month)) return false;
      if (f.marca && (item.marca ?? item?.producto?.marca) !== f.marca) return false;
      if (f.date) {
        const d = new Date(f.date);
        const itemDate = new Date(
          Number(item.anio),
          Number(item.mes) - 1,
          Number(item.dia || 1)
        );
        if (
          d.getFullYear() !== itemDate.getFullYear() ||
          d.getMonth() !== itemDate.getMonth() ||
          d.getDate() !== itemDate.getDate()
        )
          return false;
      }
      return true;
    });
  };

  const fetchVentasWithFilters = async (f) => {
    setLoadingVentas(true);
    try {
      const qs = buildQuery(f);
      const { data } = await apiFetch(`/venta?${qs}`);
      const list = Array.isArray(data) ? data : [];
      list._fromApi = true;
      setVentas(list);
      setPaginatorState((prev) => ({ ...prev, first: 0, page: 0, totalRecords: list.length }));
      showSuccess(`Se encontraron ${list.length} registros con los filtros aplicados.`);
    } catch (e) {
      const filteredData = filterLocalData(ventasBase, f);
      filteredData._fromApi = true;
      setVentas(filteredData);
      setPaginatorState((prev) => ({ ...prev, first: 0, page: 0, totalRecords: filteredData.length }));
      showWarn("No se pudo conectar a la API. Aplicando filtros localmente...");
      showInfo(`Se encontraron ${filteredData.length} registros (filtro local).`);
    } finally {
      setLoadingVentas(false);
    }
  };

  // ===== efectos =====
  useEffect(() => {
    loadMarcas();
    loadVentas();
  }, []);

  useEffect(() => {
    setPaginatorState((p) => ({ ...p, first: 0, page: 0 }));
  }, [appliedFilters, globalFilter]);

  useEffect(() => {
    loadYearsOptions();
  }, [ventasBase]);

  // Countdown update
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

  // Elapsed update
  useEffect(() => {
    if (!loadingTemplate) return;
    if (elapsedRef.current) clearInterval(elapsedRef.current);
    elapsedRef.current = setInterval(() => {
      setUploadElapsedMs((ms) => ms + 1000);
    }, 1000);
    return () => {
      if (elapsedRef.current) {
        clearInterval(elapsedRef.current);
        elapsedRef.current = null;
      }
    };
  }, [loadingTemplate]);

  const onPageChange = (e) => setPaginatorState(e);

  // ===== Filtros + búsqueda global =====
  const filteredData = useMemo(() => {
    if (!showAny) return [];

    let base = [...ventas];
    if (!showAll && hasAnyApplied && !base._fromApi) {
      base = filterLocalData(base, appliedFilters);
    }
    if (globalFilter?.trim()) {
      const lowered = globalFilter.toLowerCase();
      base = base.filter((item) =>
        Object.values(item).some((val) =>
          typeof val === "object" && val !== null
            ? Object.values(val).some((v2) => v2?.toString().toLowerCase().includes(lowered))
            : val?.toString().toLowerCase().includes(lowered)
        )
      );
    }
    return base;
  }, [ventas, hasAnyApplied, appliedFilters, globalFilter, showAny, showAll]);

  // ===== Guardar incidencias extendidas =====
  const promptSaveIncidencias = async (metrics, errores, exitos) => {
    const txt = buildIncidenciasFybecaText({
      fileName: metrics.fileName,
      fileSizeBytes: metrics.fileSizeBytes,
      estMs: metrics.etaMsUsed,
      elapsedMs: metrics.elapsedMsReal,
      startDate: new Date(metrics.startedAt),
      endDate: new Date(metrics.finishedAt),
      filasLeidas: metrics.filasLeidas,
      filasProcesadas: metrics.filasProcesadas,
      insertadas: metrics.insertadas,
      actualizadas: metrics.actualizadas,
      ignoradas: metrics.ignoradas,
      conError: metrics.conError,
      codigosExitosos: exitos,
      errores,
    });
    const fechaStr = new Date(metrics.finishedAt).toISOString().replace(/[:T]/g, "-").split(".")[0];
    await saveTextFile(txt, `incidencias_fybeca_${fechaStr}.txt`);
    showSuccess("Incidencias guardadas");
  };

  // ===== Upload (estimación + toast persistente + overlay visible) =====
  const cargarTemplate = async (file) => {
    if (!file) return showWarn("No seleccionaste ningún archivo.");
    const ext = file.name.split(".").pop().toLowerCase();
    if (!["xlsx", "xls"].includes(ext)) return showError("Tipo de archivo no soportado. Sube un Excel (.xlsx o .xls).");

    setLoadingTemplate(true);
    setUploadElapsedMs(0);

    let erroresNormalizados = [];
    let downloadedExcel = false;
    let counts = { insertadas:0, actualizadas:0, ignoradas:0, conError:0, total:0, filasLeidas: "N/D" };

    // NUEVO: contar filas leídas localmente antes de subir
    counts.filasLeidas = await countRowsInExcel(file);

    // Estimar y arrancar countdown en vivo
    const estMs = calculateUploadTime(file.size);
    setUploadRemainingMs(estMs);
    const estMin = Math.floor(estMs / 60000);
    const estSec = Math.floor((estMs % 60000) / 1000);
    const timeMessage = estMin > 0
      ? `aproximadamente ${estMin} minutos y ${estSec} segundos`
      : `aproximadamente ${estSec} segundos`;

    toast.current?.show({
      severity: 'info',
      summary: 'Cargando archivo',
      detail: `Subiendo ${file.name}. Tiempo estimado: ${timeMessage}. Por favor espere...`,
      life: 0,
      sticky: true,
      className: 'deprati-toast deprati-toast-info deprati-toast-persistent'
    });

    const start = performance.now();
    const realStart = new Date();
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const formData = new FormData();
      formData.append("file", file);

      const res = await fetch(`${API_BASE}/subir-archivo-venta`, {
        method: "POST",
        body: formData,
        signal: controller.signal,
      });

      const end = performance.now();
      const elapsedMs = Math.max(0, Math.round(end - start));
      const realEnd = new Date();

      if (!res.ok) {
        let msg = "";
        try {
          const ct = res.headers.get("Content-Type") || "";
          msg = ct.includes("application/json") ? (await res.json())?.message : await res.text();
        } catch {}
        throw new Error(msg || `Error HTTP ${res.status}`);
      }

      const contentType = res.headers.get("Content-Type") || "";
      const cd = res.headers.get("Content-Disposition");
      const suggestedFilename = getFilenameFromCD(cd) || "reporte_procesamiento.xlsx";

      if (contentType.includes("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")) {
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = suggestedFilename;
        a.click();
        URL.revokeObjectURL(url);
        downloadedExcel = true;
        if (toast.current) toast.current.clear();
        showSuccess("Archivo procesado correctamente");
      } else if (contentType.includes("application/json")) {
        const result = await res.json();
        erroresNormalizados = normalizeErrores(result);
        const cnt = extractCounts(result);
        counts = { ...counts, ...cnt };
        if (toast.current) toast.current.clear();
        showSuccess("Archivo procesado correctamente");

        if (erroresNormalizados.length > 0) {
          toast.current?.show({
            severity: "warn",
            summary: "Códigos no encontrados",
            content: (
              <div className="flex flex-column gap-3">
                <span>
                  Se detectaron <b>{erroresNormalizados.length}</b> códigos no encontrados.
                </span>
                <Button
                  label="Guardar TXT (No encontrados)"
                  icon="pi pi-save"
                  className="p-button-sm p-button-warning"
                  style={{ whiteSpace: "nowrap", padding: "0.5rem 2.5rem" }}
                  onClick={async () => {
                    const contenido = buildTxtFromErrores(erroresNormalizados);
                    const now = new Date();
                    const fechaStr = now.toISOString().replace(/[:T]/g, "-").split(".")[0];
                    await saveTextFile(contenido, `codigos_no_encontrados_${fechaStr}.txt`);
                    showSuccess("Archivo guardado correctamente");
                  }}
                />
              </div>
            ),
            sticky: true,
            className: "deprati-toast deprati-toast-warning",
          });
        }
      } else {
        const text = await res.text();
        showInfo(text?.substring(0, 200) || "Procesado.");
      }

      // Recargar datos con filtros (o todo si showAll)
      await (hasAnyApplied ? fetchVentasWithFilters(appliedFilters) : loadVentas());

      // ==== Toast final con métricas + botones de guardado ====
      const procesadas = counts.total || (typeof counts.filasLeidas === "number" ? counts.filasLeidas : 0);
      const exitosos = Math.max(0, procesadas - (counts.conError || 0));
      const metrics = {
        fileName: file.name,
        fileSizeBytes: file.size,
        etaMsUsed: estMs,
        elapsedMsReal: elapsedMs,
        startedAt: realStart.toISOString(),
        finishedAt: realEnd.toISOString(),
        filasLeidas: counts.filasLeidas,
        filasProcesadas: procesadas,
        insertadas: counts.insertadas,
        actualizadas: counts.actualizadas,
        ignoradas: counts.ignoradas,
        conError: counts.conError,
        cantErrores: counts.conError,
        cantExitos: exitosos,
        cantNoEncontrados: erroresNormalizados.length,
      };

      toast.current?.show({
        severity: metrics.cantNoEncontrados > 0 ? "warn" : "info",
        sticky: true,
        className: "deprati-toast deprati-toast-info",
        content: (
          <div className="flex flex-column gap-2">
            <div className="font-bold">{metrics.cantNoEncontrados > 0 ? "Códigos no encontrados detectados" : "Carga finalizada"}</div>
            <div>
              Tiempo real: <b>{(metrics.elapsedMsReal/1000).toFixed(1)}s</b> — ETA: <b>{(metrics.etaMsUsed/1000).toFixed(1)}s</b><br/>
              Leídas: <b>{metrics.filasLeidas ?? "N/D"}</b> | Procesadas: <b>{metrics.filasProcesadas ?? "N/D"}</b><br/>
              Insertadas: <b>{metrics.insertadas}</b> | Actualizadas: <b>{metrics.actualizadas}</b> | Ignoradas: <b>{metrics.ignoradas}</b> | Con error: <b>{metrics.conError}</b><br/>
              Éxitos: <b>{metrics.cantExitos}</b> | Errores: <b>{metrics.cantErrores}</b> | No encontrados: <b>{metrics.cantNoEncontrados}</b>
            </div>
            <div className="flex gap-2">
              <Button
                label="Guardar TXT de incidencias"
                icon="pi pi-save"
                className="p-button-sm p-button-warning"
                onClick={() => promptSaveIncidencias(metrics, erroresNormalizados, exitosos)}
              />
              {metrics.cantNoEncontrados > 0 && (
                <Button
                  label="Guardar sólo NO ENCONTRADOS"
                  icon="pi pi-file"
                  className="p-button-sm p-button-help"
                  onClick={() => {
                    const header = "CODIGOS_NO_ENCONTRADOS";
                    const body = erroresNormalizados.map(({codigo, motivo}) => `(el codigo : ${codigo}) - ${motivo || "Motivo no especificado"}`).join("\\n");
                    const contenido = [header, body].join("\\n");
                    const fechaStr = new Date(metrics.finishedAt).toISOString().replace(/[:T]/g, "-").split(".")[0];
                    saveTextFile(contenido, `codigos_no_encontrados_${fechaStr}.txt`);
                  }}
                />
              )}
            </div>
          </div>
        )
      });

    } catch (e) {
      if (toast.current) toast.current.clear();
      const msg = String(e?.message || e || 'Error inesperado');
      if (e?.name === 'AbortError') {
        showError('Tiempo de carga excedido. Puede que el servidor aún esté procesando.');
      } else if (msg.includes('Failed to fetch')) {
        showError('No se pudo conectar con el servidor. Verifica la conexión.');
      } else {
        showError(msg);
      }
    } finally {
      setUploadRemainingMs(null);
      setTimeout(() => {
        setLoadingTemplate(false);
      }, 1500);
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
  const actualizarVenta = async (venta) => {
    try {
      const payload = {
        ...venta,
        cliente: { ...(venta?.cliente || {}), codCliente: COD_CLIENTE_FIJO },
      };
      await apiFetch(`/venta/${venta.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      showSuccess("Venta actualizada correctamente");
      setEditVenta(null);
      await (hasAnyApplied ? fetchVentasWithFilters(appliedFilters) : loadVentas());
    } catch (e) {
      showError(String(e));
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
          await apiFetch(`/venta/${id}`, { method: "DELETE" });
          showSuccess("Venta eliminada correctamente");
          await (hasAnyApplied ? fetchVentasWithFilters(appliedFilters) : loadVentas());
        } catch (e) {
          showError(String(e));
        }
      },
    });
  };

  const eliminarVentasSeleccionadas = () => {
    if (selectedVentas.length === 0) {
      showInfo("No hay ventas seleccionadas para eliminar");
      return;
    }
    confirmDialog({
      message: `¿Está seguro de eliminar ${selectedVentas.length} venta(s)?`,
      header: "Confirmación de eliminación",
      icon: "pi pi-exclamation-triangle",
      acceptLabel: "Sí, eliminar",
      rejectLabel: "No, cancelar",
      acceptClassName: "p-button-danger",
      closable: false,
      accept: async () => {
        try {
          const ids = selectedVentas.map((v) => v.id).slice(0, 5000); // límite de 5000
          await apiFetch(`/ventas-forma-masiva`, {
            method: "DELETE",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(ids),
          });
          showSuccess("Ventas eliminadas correctamente");
          setSelectedVentas([]);
          await (hasAnyApplied ? fetchVentasWithFilters(appliedFilters) : loadVentas());
        } catch (e) {
          showError("Error al eliminar las ventas");
        }
      },
    });
  };

  // ===== Reportes =====
  const downloadVentasReport = async () => {
    setLoadingVentas(true);
    try {
      const { blob, filename } = await apiFetch(`/reporte-ventas`, { expect: "blob" });
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = filename || "reporte_ventas_fybeca.xlsx";
      link.click();
      showSuccess("Reporte de ventas descargado correctamente");
    } catch (e) {
      showError(String(e));
    } finally {
      setLoadingVentas(false);
    }
  };

  const downloadFilteredVentasReport = () => {
    const dataToUse = filteredData;
    if (!dataToUse.length) {
      showWarn("No hay datos filtrados para generar el reporte.");
      return;
    }
    const exportData = dataToUse.map((v) => ({
      "Año": v.anio,
      "Mes": monthLabel(v.mes),
      "Día": v.dia,
      "Marca": v.marca || v?.producto?.marca,
      "Código Barra": v.codBarra,
      "Código SAP": v.codigoSap,
      "Producto": v.nombreProducto,
      "Código PDV": v.codPdv,
      "PDV": v.pdv,
      "Ciudad": v.ciudad || (v.cliente ? v.cliente.ciudad : "N/A"),
      "Stock ($)": Number(v.stockDolares ?? 0),
      "Stock (U)": Number(v.stockUnidades ?? 0),
      "Venta ($)": Number(v.ventaDolares ?? 0),
      "Venta (U)": Number(v.ventaUnidad ?? 0),
    }));

    const ws = XLSX.utils.json_to_sheet(exportData);
    const header = Object.keys(exportData[0] || {});
    const headerRow = 1;
    const colIndexByHeader = {};
    header.forEach((h, idx) => (colIndexByHeader[h] = idx));
    const fmtCols = ["Stock ($)", "Stock (U)", "Venta ($)", "Venta (U)"];
    const range = XLSX.utils.decode_range(ws["!ref"] || "A1");
    for (let r = headerRow + 1; r <= range.e.r; r++) {
      fmtCols.forEach((h) => {
        const c = colIndexByHeader[h];
        if (c == null) return;
        const addr = XLSX.utils.encode_cell({ r, c });
        const cell = ws[addr];
        if (cell) {
          cell.t = "n";
          cell.z = "#,##0.00";
        }
      });
    }
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Ventas Filtradas");
    const today = new Date();
    const dateStr = `${today.getDate()}-${today.getMonth() + 1}-${today.getFullYear()}`;
    let fileName = "Reporte_Ventas_Fybeca_";
    if (Number.isFinite(appliedFilters.year)) fileName += `${appliedFilters.year}_`;
    if (Number.isFinite(appliedFilters.month)) fileName += `${monthLabel(appliedFilters.month)}_`;
    if (appliedFilters.marca) fileName += `${appliedFilters.marca}_`;
    fileName += dateStr + ".xlsx";
    XLSX.writeFile(wb, fileName);
    showSuccess(`Se ha generado el reporte con ${exportData.length} registros.`);
  };

  // ===== Eventos de UI =====
  const handleApplyFilters = async () => {
    if (filterMonth !== null && filterMonth !== "" && (filterYear === null || filterYear === "")) {
      showWarn("Para filtrar por Mes, selecciona primero un Año.");
      return;
    }
    const year = filterYear != null && filterYear !== "" ? Number(filterYear) : null;
    const month = filterMonth != null && filterMonth !== "" ? Number(filterMonth) : null;
    const newApplied = { year, month, marca: filterMarca, date: filterDate };
    setAppliedFilters(newApplied);
    setGlobalFilter("");
    setShowAll(false);
    await fetchVentasWithFilters(newApplied);
  };

  const handleClearFilters = async () => {
    setFilterYear(null);
    setFilterMonth(null);
    setFilterMarca("");
    setFilterDate(null);
    setGlobalFilter("");
    setMonthsOptions([]);
    setAppliedFilters({ year: null, month: null, marca: "", date: null });
    setShowAll(true);
    await loadVentas();
    showInfo("Filtros limpiados correctamente.");
  };

  const onSelectionChange = (e) => {
    const value = e.value || [];
    if (value.length > 5000) {
      showWarn("Solo puede seleccionar un máximo de 5000 registros para eliminar.");
      setSelectedVentas(value.slice(0, 5000));
    } else {
      setSelectedVentas(value);
    }
  };

  const handleFormSubmit = async (e) => {
    e.preventDefault();
    if (!editVenta) return;
    setIsSaving(true);
    try {
      await actualizarVenta(editVenta);
    } finally {
      setIsSaving(false);
    }
  };

  const renderHeader = () => (
    <div className="deprati-table-header flex flex-wrap gap-2 align-items-center justify-content-between">
      <h4 className="deprati-title m-0">Gestión de Ventas Fybeca</h4>
      <span className="deprati-search p-input-icon-left">
        <i className="pi pi-search" />
        <InputText
          value={globalFilter}
          onChange={(e) => setGlobalFilter(e.target.value || "")}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
          }}
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
          if (f) cargarTemplate(f);
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
        label="Descargar Template"
        icon="pi pi-download"
        className="p-button-raised p-button-warning"
        onClick={() => {
          const url = encodeURI("/TEMPLATE VENTAS FYBECA.xlsx");
          const link = document.createElement("a");
          link.href = url;
          link.download = "TEMPLATE VENTAS FYBECA.xlsx";
          link.click();
        }}
      />
      <Button
        label="Reporte Ventas"
        icon="pi pi-file-excel"
        className="p-button-success p-button-raised"
        onClick={downloadVentasReport}
        disabled={loadingVentas}
      />
      <Button
        label="Exportar Filtrados"
        icon="pi pi-file-excel"
        className="p-button-success p-button-raised"
        onClick={downloadFilteredVentasReport}
        disabled={!filteredData.length}
      />
    </div>
  );

  const footer = `Total de ${filteredData ? filteredData.length : 0} ventas`;

  const actionBodyTemplate = (row) => (
    <div className="deprati-row-actions flex gap-2 justify-content-center">
      <Button
        icon="pi pi-pencil"
        className="p-button-rounded p-button-outlined p-button-info"
        onClick={() => setEditVenta({ ...row })}
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

      {/* Overlay de carga con texto blanco y negrita */}
      {loadingTemplate && (
        <div className="fixed top-0 left-0 w-full h-full flex justify-content-center align-items-center bg-black-alpha-70 z-5">
          <div className="surface-card p-5 border-round shadow-2 text-center" style={{ minWidth: 360, backgroundColor: 'rgba(0,0,0,0.85)' }}>
            <ProgressSpinner style={{ width: '60px', height: '60px' }} />
            <div className="mt-3" style={{ fontWeight: 'bold', color: 'white', fontSize: '1.2rem' }}>Procesando archivo...</div>
            <div className="mt-2" style={{ fontSize: '1rem', color: 'white', fontWeight: 'bold' }}>
              {uploadRemainingMs != null
                ? <>Tiempo restante estimado:&nbsp;<span style={{ fontFamily: 'monospace', fontWeight: 'bold', color: 'white' }}>{formatDuration(uploadRemainingMs)}</span></>
                : <span style={{ color: 'white', fontWeight: 'bold' }}>Calculando tiempo estimado...</span>}
            </div>
            <div className="mt-2" style={{ fontSize: '1rem', color: 'white', fontWeight: 'bold' }}>
              Tiempo transcurrido:&nbsp;
              <span style={{ fontFamily: 'monospace', fontWeight: 'bold', color: 'white' }}>{formatDuration(uploadElapsedMs)}</span>
            </div>
            {uploadRemainingMs === 0 && (
              <div className="mt-2" style={{ fontSize: '0.9rem', color: '#f8f9fa' }}>
                Casi listo… finalizando procesamiento del servidor
              </div>
            )}
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
        <h1 className="deprati-main-title text-center text-primary my-4">Ventas Fybeca</h1>
        <Toolbar className="deprati-toolbar mb-4" left={leftToolbarTemplate} right={rightToolbarTemplate} />

        {/* Filtros */}
        <Card className="deprati-filter-card mb-4">
          <h3 className="deprati-section-title text-primary mb-3">Filtros de Búsqueda</h3>
          <div className="grid formgrid">
            <div className="flex flex-wrap gap-8 align-items-end">
              <div className="field">
                <label htmlFor="filterYear" className="deprati-label font-bold block mb-2">
                  Año
                </label>
                <Dropdown
                  id="filterYear"
                  value={filterYear}
                  options={yearsOptions}
                  onChange={async (e) => {
                    const year = e.value != null ? Number(e.value) : null;
                    setFilterYear(year);
                    setFilterMonth(null);
                    await loadMonthsOptions(year);
                  }}
                  placeholder="Seleccionar Año"
                  className="deprati-dropdown w-12rem"
                />
              </div>

              <div className="field">
                <label htmlFor="filterMonth" className="deprati-label font-bold block mb-2">
                  Mes
                </label>
                <Dropdown
                  id="filterMonth"
                  value={filterMonth}
                  options={monthsOptions}
                  onChange={(e) => setFilterMonth(e.value != null ? Number(e.value) : null)}
                  placeholder={filterYear == null ? "Seleccione primero un Año" : "Seleccionar Mes"}
                  className="deprati-dropdown w-12rem"
                  disabled={filterYear == null || monthsOptions.length === 0}
                />
              </div>

              <div className="field">
                <label htmlFor="filterMarca" className="deprati-label font-bold block mb-2">
                  Marca
                </label>
                <Dropdown
                  id="filterMarca"
                  value={filterMarca}
                  options={marcas.map((m) => ({ label: m, value: m }))}
                  onChange={(e) => setFilterMarca(e.value)}
                  placeholder="Seleccionar Marca"
                  className="deprati-dropdown w-12rem"
                />
              </div>

              <div className="field">
                <label htmlFor="filterDate" className="deprati-label font-bold block mb-2">
                  Fecha específica
                </label>
                <Calendar
                  id="filterDate"
                  value={filterDate}
                  onChange={(e) => setFilterDate(e.value || null)}
                  dateFormat="dd/mm/yy"
                  placeholder="Seleccione la fecha"
                  className="deprati-calendar w-14rem"
                  showIcon
                  inputClassName="text-black font-bold"
                />
              </div>
            </div>
          </div>

          <Divider className="deprati-divider" />
          <div className="deprati-filter-actions flex justify-content-end gap-3 mt-3">
            <Button
              label="Aplicar Filtro"
              icon="pi pi-filter"
              onClick={handleApplyFilters}
              className="p-button-primary p-button-raised deprati-button deprati-button-apply"
            />
            <Button
              label="Limpiar Filtros"
              icon="pi pi-times"
              onClick={handleClearFilters}
              className="p-button-raised p-button-outlined deprati-button deprati-button-clear"
            />
          </div>
        </Card>

        {/* Tabla */}
        <div className="card">
          <DataTable
            value={filteredData}
            paginator
            rows={paginatorState.rows}
            rowsPerPageOptions={[5, 10, 25, 50]}
            totalRecords={paginatorState.totalRecords}
            first={paginatorState.first}
            onPage={onPageChange}
            paginatorClassName="p-3 deprati-square-paginator"
            paginatorTemplate="FirstPageLink PrevPageLink PageLinks NextPageLink LastPageLink RowsPerPageDropdown CurrentPageReport"
            currentPageReportTemplate="Mostrando {first} a {last} de {totalRecords} registros"
            dataKey="id"
            selectionMode={'checkbox'}
            selection={selectedVentas}
            onSelectionChange={onSelectionChange}
            selectionPageOnly={false}
            responsiveLayout="scroll"
            stripedRows
            showGridlines
            header={renderHeader}
            footer={footer}
            emptyMessage="No se encontraron registros"
            loading={loadingVentas}
            className="p-datatable-sm"
            tableStyle={{ minWidth: '50rem' }}
            resizableColumns
            columnResizeMode="fit"
          >
            <Column selectionMode="multiple" headerStyle={{ width: '3rem' }} headerCheckbox />
            <Column field="anio" header="Año" sortable style={{ width: '8%' }} />
            <Column field="mes" header="Mes" sortable style={{ width: '8%' }} />
            <Column field="dia" header="Día" sortable style={{ width: '8%' }} />
            <Column field="marca" header="Marca" sortable style={{ width: '10%' }} />
            <Column field="codPdv" header="Código PDV" sortable style={{ width: '10%' }} />
            <Column field="pdv" header="PDV" sortable style={{ width: '12%' }} />
            <Column field="ciudad" header="Ciudad" sortable style={{ width: '10%' }} />
            <Column field="nombreProducto" header="Producto" sortable style={{ width: '15%' }} />
            <Column field="codBarra" header="Código Barra" sortable style={{ width: '10%' }} />
            <Column
              field="stockDolares"
              header="Stock ($)"
              sortable
              body={(r) => r?.stockDolares !== undefined ? Number(r.stockDolares).toFixed(2) : "0.00"}
              style={{ width: '10%' }}
            />
            <Column
              field="stockUnidades"
              header="Stock (U)"
              sortable
              body={(r) => r?.stockUnidades !== undefined ? Number(r.stockUnidades).toFixed(0) : "0"}
              style={{ width: '10%' }}
            />
            <Column
              field="ventaDolares"
              header="Venta ($)"
              sortable
              body={(r) => r?.ventaDolares !== undefined ? Number(r.ventaDolares).toFixed(2) : "0.00"}
              style={{ width: '10%' }}
            />
            <Column
              field="ventaUnidad"
              header="Venta (U)"
              sortable
              body={(r) => r?.ventaUnidad !== undefined ? Number(r.ventaUnidad).toFixed(0) : "0"}
              style={{ width: '10%' }}
            />
            <Column body={actionBodyTemplate} exportable={false} style={{ width: '8%' }} header="Acciones" />
          </DataTable>
        </div>

        {/* Diálogo de edición */}
        <Dialog
          key={editVenta?.id || 'new'}
          visible={editVenta !== null}
          onHide={() => setEditVenta(null)}
          header={
            <div className="flex justify-content-between align-items-center w-full">
              <span className="text-white text-lg font-semibold">Editar Venta</span>
              <Button
                icon="pi pi-times"
                className="p-button-rounded p-button-text p-button-plain text-white"
                onClick={() => setEditVenta(null)}
                aria-label="Cerrar"
              />
            </div>
          }
          className="deprati-edit-dialog p-fluid surface-overlay shadow-3"
          style={{ width: '70vw', maxWidth: '1200px' }}
          modal
          closable={false}
          dismissableMask
          breakpoints={{ '960px': '85vw', '641px': '95vw' }}
        >
          <form onSubmit={handleFormSubmit} className="deprati-form p-4" style={{ fontSize: '1.05rem' }}>
            <div className="p-4 mb-5 border-1 border-round surface-card shadow-2">
              <div className="text-lg font-semibold text-primary mb-3">Información General</div>
              <div className="grid formgrid p-fluid gap-4">
                {[
                  { id: 'anio', label: 'Año', value: editVenta?.anio },
                  { id: 'mes', label: 'Mes', value: editVenta?.mes },
                  { id: 'dia', label: 'Día', value: editVenta?.dia }
                ].map((f) => (
                  <div key={f.id} className="col-12 md:col-3">
                    <span className="p-float-label w-full">
                      <InputNumber
                        id={f.id}
                        value={f.value}
                        onValueChange={(e) => setEditVenta({ ...editVenta, [f.id]: e.value })}
                        className="w-full"
                        inputStyle={{ fontSize: '1.1rem', padding: '0.85rem', height: '3.2rem' }}
                        useGrouping={false}
                      />
                      <label htmlFor={f.id} style={{ fontSize: '1rem' }}>{f.label}</label>
                    </span>
                  </div>
                ))}
                <div className="col-12 md:col-3">
                  <span className="p-float-label w-full">
                    <InputText
                      id="marca"
                      value={editVenta?.marca || ""}
                      className={`w-full ${!editVenta?.marca ? 'p-invalid' : ''}`}
                      onChange={(e) => setEditVenta({ ...editVenta, marca: e.target.value })}
                      inputStyle={{ fontSize: '1.1rem', padding: '0.85rem', height: '3.2rem' }}
                    />
                    <label htmlFor="marca" style={{ fontSize: '1rem' }}>Marca</label>
                  </span>
                  {!editVenta?.marca && <small className="p-error">La marca es requerida</small>}
                </div>
                {[
                  { id: 'codPdv', label: 'Código PDV' },
                  { id: 'pdv', label: 'PDV' },
                  { id: 'ciudad', label: 'Ciudad' }
                ].map((f) => (
                  <div key={f.id} className="col-12 md:col-4">
                    <span className="p-float-label w-full">
                      <InputText
                        id={f.id}
                        value={editVenta?.[f.id] || ""}
                        onChange={(e) => setEditVenta({ ...editVenta, [f.id]: e.target.value })}
                        className="w-full"
                        inputStyle={{ fontSize: '1.1rem', padding: '0.85rem', height: '3.2rem' }}
                      />
                      <label htmlFor={f.id} style={{ fontSize: '1rem' }}>{f.label}</label>
                    </span>
                  </div>
                ))}
              </div>
            </div>

            <div className="p-4 mb-5 border-1 border-round surface-card shadow-2">
              <div className="text-lg font-semibold text-primary mb-3">Información de Producto</div>
              <div className="grid formgrid p-fluid gap-3">
                <div className="col-12">
                  <span className="p-float-label w-full">
                    <InputText
                      id="nombreProducto"
                      value={editVenta?.nombreProducto || ""}
                      onChange={(e) => setEditVenta({ ...editVenta, nombreProducto: e.target.value })}
                      className="w-full"
                      inputStyle={{ fontSize: '1.1rem', padding: '0.85rem', height: '3.2rem' }}
                    />
                    <label htmlFor="nombreProducto" style={{ fontSize: '1rem' }}>Producto</label>
                  </span>
                </div>
                <div className="col-12 md:col-6">
                  <span className="p-float-label w-full">
                    <InputText
                      id="codBarra"
                      value={editVenta?.codBarra || ""}
                      onChange={(e) => setEditVenta({ ...editVenta, codBarra: e.target.value })}
                      className="w-full"
                      inputStyle={{ fontSize: '1.1rem', padding: '0.85rem', height: '3.2rem' }}
                    />
                    <label htmlFor="codBarra" style={{ fontSize: '1rem' }}>Código de Barra</label>
                  </span>
                </div>
              </div>
            </div>

            <div className="p-4 mb-5 border-1 border-round surface-card shadow-2">
              <div className="text-lg font-semibold text-primary mb-3">Información de Stock y Ventas</div>
              <div className="grid formgrid p-fluid gap-3">
                {[
                  { id: 'stockDolares', label: 'Stock ($)', mode: 'decimal' },
                  { id: 'stockUnidades', label: 'Stock (U)' },
                  { id: 'ventaDolares', label: 'Venta ($)', mode: 'decimal' },
                  { id: 'ventaUnidad', label: 'Venta (U)' }
                ].map((f) => (
                  <div key={f.id} className="col-12 md:col-4">
                    <span className="p-float-label w-full">
                      <InputNumber
                        id={f.id}
                        value={editVenta?.[f.id]}
                        onValueChange={(e) => setEditVenta({ ...editVenta, [f.id]: e.value })}
                        className="w-full"
                        inputStyle={{ fontSize: '1.1rem', padding: '0.85rem', height: '3.2rem' }}
                        mode={f.mode}
                        minFractionDigits={f.mode === 'decimal' ? 2 : undefined}
                      />
                      <label htmlFor={f.id} style={{ fontSize: '1rem' }}>{f.label}</label>
                    </span>
                  </div>
                ))}
              </div>
            </div>

            <div className="flex justify-content-end gap-2 mt-4 pt-4 border-top-1 border-300 bg-gray-100 p-3 border-round-bottom">
              <Button
                label="Cancelar"
                icon="pi pi-times"
                onClick={() => setEditVenta(null)}
                className="p-button-outlined p-button-secondary"
                type="button"
                style={{ fontSize: '1.05rem', padding: '0.75rem 1.5rem' }}
              />
              <Button
                label={isSaving ? "Guardando..." : "Guardar"}
                icon={isSaving ? "pi pi-spin pi-spinner" : "pi pi-check"}
                disabled={isSaving}
                type="submit"
                autoFocus
                className="p-button-primary"
                style={{ fontSize: '1.05rem', padding: '0.75rem 1.5rem' }}
              />
            </div>
          </form>
        </Dialog>
      </div>
    </div>
  );
};

export default Fybeca;
