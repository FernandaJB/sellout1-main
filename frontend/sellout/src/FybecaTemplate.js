import React, { useEffect, useMemo, useRef, useState } from "react";
import "./css/deprati.css";

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
const COD_CLIENTE_FIJO = "MZCL-000014"; // forzar siempre codCliente

const MAX_DELETE = 2000;

const getFilenameFromCD = (cd) => {
  if (!cd) return null;
  const m = /filename\*=UTF-8''([^;\n]+)|filename=\"?([^\";\n]+)\"?/i.exec(cd);
  if (m) return decodeURIComponent((m[1] || m[2] || "").trim());
  return null;
};

// ✅ CAMBIO: soporte timeout opcional. Si timeoutMs es null/0 -> NO se aplica timeout.
async function apiFetch(
  path,
  { method = "GET", headers = {}, body, expect = "json", timeoutMs = 300000 } = {}
) {
  const signal = timeoutMs ? AbortSignal.timeout(timeoutMs) : undefined;

  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: {
      ...(expect === "json" ? { Accept: "application/json" } : {}),
      ...headers,
    },
    body,
    signal,
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
    throw new Error([base, msg && `Detalle: ${msg}`, corr && `Correlation-Id: ${corr}`].filter(Boolean).join(" | "));
  }

  if (expect === "blob") {
    const blob = await res.blob();
    const filename = getFilenameFromCD(res.headers.get("Content-Disposition"));
    const contentType = res.headers.get("Content-Type") || "";
    return { blob, filename, contentType, headers: res.headers };
  }

  if (expect === "text") {
    const text = await res.text();
    return { text, headers: res.headers };
  }

  const ct = res.headers.get("Content-Type") || "";
  if (ct.includes("application/json")) {
    const data = await res.json();
    return { data, headers: res.headers };
  }
  const textFallback = await res.text();
  return { data: textFallback, headers: res.headers };
}

// ================= Utilidades de mes =================
const monthNames = [
  "Enero","Febrero","Marzo","Abril","Mayo","Junio",
  "Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre",
];
const monthLabel = (m) => monthNames[(Number(m || 1) - 1)] || m;

const num = (v, def = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
};

// ================= Helpers de Incidencias / Log TXT =================
const TXT_HEADER = "CODIGOS_NO_ENCONTRADOS";

const normalizeErrores = (result) => {
  const toObj = (x, motivoFallback = "Motivo no especificado") =>
    typeof x === "object"
      ? ({
          codigo: x.codigo ?? x.cod ?? x.code ?? x.id ?? "N/D",
          motivo: x.motivo ?? x.error ?? x.mensaje ?? motivoFallback,
        })
      : ({ codigo: String(x), motivo: motivoFallback });

  if (Array.isArray(result?.codigosNoEncontrados)) return result.codigosNoEncontrados.map((x) => toObj(x, "No se pudo mapear el código"));
  if (Array.isArray(result?.errores)) return result.errores.map((x) => toObj(x, "Motivo no especificado"));
  if (Array.isArray(result?.itemsFallidos)) return result.itemsFallidos.map((x) => toObj(x, "Motivo no especificado"));
  if (Array.isArray(result)) return result.map((x) => toObj(x, "Motivo no especificado"));
  if (Array.isArray(result?.lista)) {
    return result.lista.map((c) => ({ codigo: String(c), motivo: result?.motivo ?? "Motivo no especificado" }));
  }
  return [];
};

const extractCounts = (result) => {
  const r = result || {};
  const possible = (obj, keys, def = 0) => {
    for (const k of keys) {
      const v = obj?.[k];
      if (typeof v === "number" && Number.isFinite(v)) return v;
      if (typeof v === "string" && v.trim() && !isNaN(Number(v))) return Number(v);
      if (typeof v === "object" && v && (v.value ?? v.val ?? v.count) != null) {
        const vv = Number(v.value ?? v.val ?? v.count);
        if (Number.isFinite(vv)) return vv;
      }
    }
    return def;
  };

  const src = r.resumen ?? r.summary ?? r.stats ?? r;

  const insertadas = possible(src, ["filasInsertadas","insertadas","inserted","inserts","created"]);
  const actualizadas = possible(src, ["filasActualizadas","actualizadas","updated","updates","upserts"]);
  const ignoradas = possible(src, ["filasIgnoradas","ignoradas","skipped","omitidas"]);
  const conError = possible(src, ["filasConError","errores","withErrors","failed","fallidas"]);
  let total = possible(src, ["total","filas","totalFilas","rows","processed"]);
  if (!total) total = insertadas + actualizadas + ignoradas + conError;

  const filasLeidas = src?.filasLeidas ?? r?.filasLeidas ?? "N/D";
  return { insertadas, actualizadas, ignoradas, conError, total, filasLeidas };
};

const buildTxtFromErrores = (errores) => {
  const lines = [TXT_HEADER];
  errores.forEach(({ codigo, motivo }) => {
    lines.push(`(el codigo : ${codigo}) - ${motivo || "Motivo no especificado"}`);
  });
  return lines.join("\n");
};

const z2 = (n) => String(n).padStart(2, "0");
const formatHHMMSS = (ms) => {
  const total = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${z2(h)}:${z2(m)}:${z2(s)}`;
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
  const fecha = startDate.toLocaleDateString();
  const horaInicio = startDate.toLocaleTimeString();
  const horaFin = endDate.toLocaleTimeString();

  const header = [
    "==== INCIDENCIAS DE CARGA — VENTAS FYBECA ====",
    `Fecha: ${fecha}`,
    `Hora inicio: ${horaInicio}`,
    `Hora fin: ${horaFin}`,
    `Archivo: ${fileName || "N/D"}`,
    `Tamaño: ${sizeMB.toFixed(2)} MB (${fileSizeBytes} bytes)`,
    `ETA (estimado): ${formatHHMMSS(estMs)} (${Math.round(estMs)} ms)`,
    `Tiempo real: ${formatHHMMSS(elapsedMs)} (${Math.round(elapsedMs)} ms)`,
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
  ].join("\n");

  const body = (errores && errores.length)
    ? errores.map(({ codigo, motivo }) => `(el codigo : ${codigo}) - ${motivo || "No se pudo mapear el código"}`).join("\n")
    : "(sin incidencias)";

  return header + "\n" + body + "\n\n==============================================\n";
};

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
        resolve(Math.max(0, count - 1));
      } catch {
        resolve("N/D");
      }
    };
    reader.onerror = () => resolve("N/D");
    reader.readAsArrayBuffer(file);
  });

const Fybeca = () => {
  const toast = useRef(null);
  const fileInputRef = useRef(null);
  const abortRef = useRef(null);

  const countdownRef = useRef(null);
  const elapsedRef = useRef(null);

  // data
  const [ventas, setVentas] = useState([]);
  const [ventasBase, setVentasBase] = useState([]);
  const [loadingVentas, setLoadingVentas] = useState(false);

  // selection / edit
  const [selectedVentas, setSelectedVentas] = useState([]);
  const [editVenta, setEditVenta] = useState(null);
  const [isSaving, setIsSaving] = useState(false);

  // overlay
  const [loadingTemplate, setLoadingTemplate] = useState(false);
  const [uploadRemainingMs, setUploadRemainingMs] = useState(null);
  const [uploadElapsedMs, setUploadElapsedMs] = useState(0);

  // filtros draft + applied
  const [marcas, setMarcas] = useState([]);
  const [yearsOptions, setYearsOptions] = useState([]);
  const [monthsOptions, setMonthsOptions] = useState([]);

  const [filterYear, setFilterYear] = useState(null);
  const [filterMonth, setFilterMonth] = useState(null);
  const [filterMarca, setFilterMarca] = useState("");
  const [filterDateRange, setFilterDateRange] = useState(null); // [from, to]
  const [globalFilter, setGlobalFilter] = useState("");

  const [appliedFilters, setAppliedFilters] = useState({ year: null, month: null, marca: "", dateFrom: null, dateTo: null });

  // para mostrar todo al inicio
  const [showAll, setShowAll] = useState(true);

  // paginator
  const [paginatorState, setPaginatorState] = useState({ first: 0, rows: 50, page: 0, totalRecords: 0 });
  const [fullDataLoaded, setFullDataLoaded] = useState(false);

  // logs para toolbar (igual TemplateGeneral)
  const [lastErrores, setLastErrores] = useState([]);
  const [incidenciasTxt, setIncidenciasTxt] = useState(null);
  const [incidenciasName, setIncidenciasName] = useState(null);
  const [logDetalladoTxt, setLogDetalladoTxt] = useState(null);
  const [logDetalladoName, setLogDetalladoName] = useState(null);

  // ===== Toast helpers =====
  const showToast = ({ type = "info", summary, detail, life = 3500, content, sticky, className }) =>
    toast.current?.show({ severity: type, summary, detail, life, content, sticky, className });
  const showSuccess = (m) => showToast({ type: "success", summary: "Éxito", detail: m });
  const showInfo = (m) => showToast({ type: "info", summary: "Información", detail: m });
  const showWarn = (m) => showToast({ type: "warn", summary: "Advertencia", detail: m });
  const showError = (m) => showToast({ type: "error", summary: "Error", detail: m, life: 8000 });

  // ===== loads =====
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
    } catch {
      const years = [...new Set(ventasBase.map((v) => v.anio))].filter(Number.isFinite).sort((a, b) => a - b);
      setYearsOptions(years.map((y) => ({ label: String(y), value: y })));
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
        .map((item) => Number(typeof item === "object" ? item?.mes ?? item?.month ?? item?.value : item))
        .filter((m) => Number.isFinite(m) && m >= 1 && m <= 12)
        .sort((a, b) => a - b);
      const opts = (months.length ? months : Array.from({ length: 12 }, (_, i) => i + 1)).map((m) => ({ label: monthLabel(m), value: m }));
      setMonthsOptions(opts);
    } catch {
      const months = [...new Set(ventasBase.filter((v) => v.anio === anio).map((v) => v.mes))]
        .filter((m) => Number.isFinite(m) && m >= 1 && m <= 12)
        .sort((a, b) => a - b);
      const opts = (months.length ? months : Array.from({ length: 12 }, (_, i) => i + 1)).map((m) => ({ label: monthLabel(m), value: m }));
      setMonthsOptions(opts);
    }
  };

  const loadVentasPage = async () => {
    setLoadingVentas(true);
    try {
      // Cargar todos los datos sin paginación para paginación del lado del cliente
      const qs = new URLSearchParams({
        codCliente: COD_CLIENTE_FIJO,
        limit: "100000", // Alto límite para traer todos los datos
      });
      const { data } = await apiFetch(`/venta?${qs.toString()}`);
      const list = (Array.isArray(data) ? data : []).map((v) =>
        v?.cliente?.ciudad ? { ...v, ciudad: v.cliente.ciudad } : v
      );
      list._fromApi = true;
      setVentas(list);
      setVentasBase(list);
      setPaginatorState((p) => ({
        ...p,
        page: 0,
        totalRecords: list.length,
      }));
      setShowAll(true);
      setFullDataLoaded(true);
    } catch {
      showError("Error al cargar ventas");
      setVentas([]);
      setVentasBase([]);
      setPaginatorState((p) => ({ ...p, first: 0, page: 0, totalRecords: 0 }));
    } finally {
      setLoadingVentas(false);
    }
  };

  // ===== filtros helpers =====
  const hasAnyApplied = useMemo(
    () =>
      appliedFilters.year !== null ||
      appliedFilters.month !== null ||
      !!appliedFilters.marca ||
      !!appliedFilters.dateFrom ||
      !!appliedFilters.dateTo,
    [appliedFilters]
  );

  const buildQuery = (f) => {
    const params = new URLSearchParams();
    if (f.year !== null) params.set("anio", String(f.year));
    if (f.month !== null) params.set("mes", String(f.month));
    if (f.marca) params.set("marca", f.marca);
    if (f.dateFrom) {
      const d = new Date(f.dateFrom);
      const yyyy = d.getFullYear();
      const mm = String(d.getMonth() + 1).padStart(2, "0");
      const dd = String(d.getDate()).padStart(2, "0");
      params.set("fechaDesde", `${yyyy}-${mm}-${dd}`);
    }
    if (f.dateTo) {
      const d = new Date(f.dateTo);
      const yyyy = d.getFullYear();
      const mm = String(d.getMonth() + 1).padStart(2, "0");
      const dd = String(d.getDate()).padStart(2, "0");
      params.set("fechaHasta", `${yyyy}-${mm}-${dd}`);
    }
    params.set("codCliente", COD_CLIENTE_FIJO);
    return params.toString();
  };

  const filterLocalData = (data, f) => {
    return (data || []).filter((item) => {
      const cod = (item?.cliente?.codCliente ?? item?.codCliente ?? "").trim();
      if (cod !== COD_CLIENTE_FIJO) return false;
      if (f.year !== null && Number(item.anio) !== Number(f.year)) return false;
      if (f.month !== null && Number(item.mes) !== Number(f.month)) return false;
      if (f.marca && (item.marca ?? item?.producto?.marca) !== f.marca) return false;

      if (f.dateFrom || f.dateTo) {
        const itemDate = new Date(Number(item.anio), Number(item.mes) - 1, Number(item.dia || 1));
        if (f.dateFrom) {
          const from = new Date(f.dateFrom);
          if (itemDate < new Date(from.getFullYear(), from.getMonth(), from.getDate())) return false;
        }
        if (f.dateTo) {
          const to = new Date(f.dateTo);
          if (itemDate > new Date(to.getFullYear(), to.getMonth(), to.getDate())) return false;
        }
      }
      return true;
    });
  };

  const fetchVentasWithFilters = async (f) => {
    const y = Number(f?.year);
    const m = f?.month != null ? Number(f.month) : null;
    if (!Number.isFinite(y)) {
      showWarn("Seleccione un año (y opcional mes) para cargar ventas.");
      setVentas([]);
      return;
    }
    setLoadingVentas(true);
    try {
      const qs = new URLSearchParams();
      qs.set("anio", String(y));
      if (m !== null && Number.isFinite(m)) qs.set("mes", String(m));
      if (f.marca) qs.set("marca", f.marca);
      qs.set("codCliente", COD_CLIENTE_FIJO);
      // Traer todos los datos para paginación del lado del cliente
      qs.set("limit", "100000");
      const { data } = await apiFetch(`/venta?${qs.toString()}`);
      const list = Array.isArray(data) ? data : [];
      list._fromApi = true;
      setVentas(list);
      setPaginatorState((prev) => ({
        ...prev,
        first: 0,
        page: 0,
        totalRecords: list.length,
      }));
      showSuccess(`Se encontraron ${list.length} registros con los filtros aplicados.`);
    } catch {
      const filtered = filterLocalData(ventasBase, f);
      filtered._fromApi = true;
      setVentas(filtered);
      setPaginatorState((prev) => ({ ...prev, first: 0, page: 0, totalRecords: filtered.length }));
      showWarn("No se pudo conectar a la API. Aplicando filtros localmente...");
      showInfo(`Se encontraron ${filtered.length} registros (filtro local).`);
    } finally {
      setLoadingVentas(false);
    }
  };

  // ===== efectos =====
  useEffect(() => {
    loadMarcas();
    loadYearsOptions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    loadYearsOptions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ventasBase]);

  useEffect(() => {
    if (uploadRemainingMs == null) return;
    if (countdownRef.current) clearInterval(countdownRef.current);
    countdownRef.current = setInterval(() => {
      setUploadRemainingMs((ms) => (ms == null ? null : Math.max(0, ms - 1000)));
    }, 1000);
    return () => {
      if (countdownRef.current) clearInterval(countdownRef.current);
      countdownRef.current = null;
    };
  }, [uploadRemainingMs]);

  useEffect(() => {
    if (!loadingTemplate) return;
    if (elapsedRef.current) clearInterval(elapsedRef.current);
    elapsedRef.current = setInterval(() => setUploadElapsedMs((ms) => ms + 1000), 1000);
    return () => {
      if (elapsedRef.current) clearInterval(elapsedRef.current);
      elapsedRef.current = null;
    };
  }, [loadingTemplate]);

  // Resetear paginación cuando cambian los filtros
  useEffect(() => {
    setPaginatorState((prev) => ({ ...prev, first: 0, page: 0 }));
  }, [appliedFilters, globalFilter]);

  // ===== paginación =====
  const onPageChange = (e) => {
    setPaginatorState((p) => ({ ...p, first: e.first, rows: e.rows, page: e.page }));
  };

  // ===== Filtros + búsqueda global =====
  const filteredData = useMemo(() => {
    if (!showAll && !hasAnyApplied && !(globalFilter?.trim())) return [];

    let base = ventas;
    if (!showAll && hasAnyApplied && !base?._fromApi) base = filterLocalData(base, appliedFilters);

    if (globalFilter?.trim()) {
      const lowered = globalFilter.toLowerCase();
      base = base.filter((item) =>
        Object.values(item).some((val) =>
          typeof val === "object" && val !== null
            ? Object.values(val).some((v2) => String(v2 ?? "").toLowerCase().includes(lowered))
            : String(val ?? "").toLowerCase().includes(lowered)
        )
      );
    }
    return base;
  }, [ventas, showAll, hasAnyApplied, appliedFilters, globalFilter, ventasBase]);

  // ===== Guardado toolbar =====
  const handleSaveIncidencias = async () => {
    if (!incidenciasTxt) return showWarn("No hay incidencias generadas todavía.");
    const ok = await saveTextFile(incidenciasTxt, incidenciasName || "incidencias_fybeca.txt");
    if (ok) showSuccess("Incidencias guardadas.");
  };

  const handleSaveLogDetallado = async () => {
    if (!logDetalladoTxt) return showWarn("No hay log detallado generado todavía.");
    const ok = await saveTextFile(logDetalladoTxt, logDetalladoName || "log_detallado_fybeca.txt");
    if (ok) showSuccess("Log detallado guardado.");
  };

  const handleSaveNoEncontrados = async () => {
    if (!lastErrores?.length) return showWarn("No hay códigos no encontrados.");
    const contenido = buildTxtFromErrores(lastErrores);
    const fechaStr = new Date().toISOString().replace(/[:T]/g, "-").split(".")[0];
    const ok = await saveTextFile(contenido, `codigos_no_encontrados_${fechaStr}.txt`);
    if (ok) showSuccess("Archivo guardado correctamente");
  };

  // ===== Upload =====
  const cargarTemplate = async (file) => {
    if (!file) return showWarn("No seleccionaste ningún archivo.");
    const ext = file.name.split(".").pop().toLowerCase();
    if (!["xlsx", "xls"].includes(ext)) return showError("Tipo de archivo no soportado. Sube un Excel (.xlsx o .xls).");

    setLoadingTemplate(true);
    setUploadElapsedMs(0);
    setUploadRemainingMs(calculateUploadTime(file.size));

    // limpiar logs previos
    setLastErrores([]);
    setIncidenciasTxt(null);
    setIncidenciasName(null);
    setLogDetalladoTxt(null);
    setLogDetalladoName(null);

    let counts = { insertadas:0, actualizadas:0, ignoradas:0, conError:0, total:0, filasLeidas:"N/D" };
    counts.filasLeidas = await countRowsInExcel(file);

    toast.current?.show({
      severity: "info",
      summary: "Cargando archivo",
      detail: `Subiendo ${file.name}. ETA: ${formatDuration(uploadRemainingMs)}. Por favor espere...`,
      life: 0,
      sticky: true,
      className: "deprati-toast deprati-toast-info deprati-toast-persistent",
    });

    const startPerf = performance.now();
    const startReal = new Date();

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

      const endPerf = performance.now();
      const elapsedMs = Math.max(0, Math.round(endPerf - startPerf));
      const endReal = new Date();

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

      let erroresNormalizados = [];

      // Caso 1: backend devuelve Excel
      if (contentType.includes("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")) {
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = suggestedFilename;
        a.click();
        URL.revokeObjectURL(url);
        if (toast.current) toast.current.clear();
        showSuccess("Archivo procesado correctamente (reporte descargado).");
      }
      // Caso 2: backend devuelve JSON
      else if (contentType.includes("application/json")) {
        const result = await res.json();
        erroresNormalizados = normalizeErrores(result);
        setLastErrores(erroresNormalizados);

        const cnt = extractCounts(result);
        counts = { ...counts, ...cnt };

        if (toast.current) toast.current.clear();
        showSuccess("Archivo procesado correctamente");

        if (erroresNormalizados.length > 0) {
          showToast({
            type: "warn",
            summary: "Códigos no encontrados",
            sticky: true,
            className: "deprati-toast deprati-toast-warning",
            content: (
              <div className="flex flex-column gap-2">
                <span>
                  Se detectaron <b>{erroresNormalizados.length}</b> códigos no encontrados.
                </span>
                <Button
                  label="Guardar sólo NO ENCONTRADOS"
                  icon="pi pi-save"
                  className="p-button-sm p-button-warning"
                  onClick={handleSaveNoEncontrados}
                />
              </div>
            ),
          });
        }
      } else {
        const text = await res.text();
        showInfo(text?.substring(0, 200) || "Procesado.");
      }

      // recargar tabla
      await (hasAnyApplied ? fetchVentasWithFilters(appliedFilters) : loadVentasPage());

      // construir incidencias + log detallado para toolbar (igual TemplateGeneral)
      const procesadas = counts.total || (typeof counts.filasLeidas === "number" ? counts.filasLeidas : 0);
      const exitosos = Math.max(0, procesadas - (counts.conError || 0));

      const estMs = uploadRemainingMs ?? calculateUploadTime(file.size);

      const incTxt = buildIncidenciasFybecaText({
        fileName: file.name,
        fileSizeBytes: file.size,
        estMs,
        elapsedMs,
        startDate: startReal,
        endDate: endReal,
        filasLeidas: counts.filasLeidas,
        filasProcesadas: procesadas,
        insertadas: counts.insertadas,
        actualizadas: counts.actualizadas,
        ignoradas: counts.ignoradas,
        conError: counts.conError,
        codigosExitosos: exitosos,
        errores: erroresNormalizados,
      });

      const fechaStr = endReal.toISOString().replace(/[:T]/g, "-").split(".")[0];
      setIncidenciasTxt(incTxt);
      setIncidenciasName(`incidencias_fybeca_${fechaStr}.txt`);

      const logDet = [
        "LOG_DETALLADO_CARGA_FYBECA",
        `ARCHIVO: ${file.name}`,
        `TAMANO_BYTES: ${file.size}`,
        `ETA_MS: ${Math.round(estMs)}`,
        `TIEMPO_REAL_MS: ${Math.round(elapsedMs)}`,
        "",
        "RESUMEN:",
        `  LEIDAS: ${counts.filasLeidas}`,
        `  PROCESADAS: ${procesadas}`,
        `  INSERTADAS: ${counts.insertadas}`,
        `  ACTUALIZADAS: ${counts.actualizadas}`,
        `  IGNORADAS: ${counts.ignoradas}`,
        `  CON_ERROR: ${counts.conError}`,
        `  EXITOS: ${exitosos}`,
        `  NO_ENCONTRADOS: ${erroresNormalizados.length}`,
      ].join("\n");

      setLogDetalladoTxt(logDet);
      setLogDetalladoName(`log_detallado_fybeca_${fechaStr}.txt`);

      // Toast final (resumen)
      showToast({
        type: erroresNormalizados.length > 0 ? "warn" : "info",
        summary: "Carga finalizada",
        sticky: true,
        className: "deprati-toast deprati-toast-info",
        content: (
          <div className="flex flex-column gap-2">
            <div>
              Tiempo real: <b>{(elapsedMs / 1000).toFixed(1)}s</b> — ETA: <b>{(estMs / 1000).toFixed(1)}s</b>
              <br />
              Leídas: <b>{counts.filasLeidas ?? "N/D"}</b> | Procesadas: <b>{procesadas ?? "N/D"}</b>
              <br />
              Insertadas: <b>{counts.insertadas}</b> | Actualizadas: <b>{counts.actualizadas}</b> | Ignoradas: <b>{counts.ignoradas}</b> | Con error: <b>{counts.conError}</b>
              <br />
              Éxitos: <b>{exitosos}</b> | No encontrados: <b>{erroresNormalizados.length}</b>
            </div>
            <div className="flex gap-2 flex-wrap">
              <Button label="Guardar Incidencias" icon="pi pi-save" className="p-button-sm p-button-warning" onClick={handleSaveIncidencias} disabled={!incTxt}/>
              <Button label="Guardar Log detallado" icon="pi pi-save" className="p-button-sm p-button-secondary" onClick={handleSaveLogDetallado} disabled={!logDet}/>
            </div>
          </div>
        ),
      });

    } catch (e) {
      if (toast.current) toast.current.clear();
      const msg = String(e?.message || e || "Error inesperado");
      if (e?.name === "AbortError") showError("Carga cancelada o tiempo excedido.");
      else if (msg.includes("Failed to fetch")) showError("No se pudo conectar con el servidor. Verifica la conexión.");
      else showError(msg);
    } finally {
      setUploadRemainingMs(null);
      setTimeout(() => setLoadingTemplate(false), 900);
      abortRef.current = null;

      if (countdownRef.current) clearInterval(countdownRef.current);
      countdownRef.current = null;
      if (elapsedRef.current) clearInterval(elapsedRef.current);
      elapsedRef.current = null;
    }
  };

  // ===== CRUD =====
  const actualizarVenta = async (venta) => {
    const payload = { ...venta, cliente: { ...(venta?.cliente || {}), codCliente: COD_CLIENTE_FIJO } };
    await apiFetch(`/venta/${venta.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
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
          await (hasAnyApplied ? fetchVentasWithFilters(appliedFilters) : loadVentasPage());
        } catch (e) {
          showError(String(e));
        }
      },
    });
  };

  const eliminarVentasSeleccionadas = () => {
    if (!selectedVentas.length) return showInfo("No hay ventas seleccionadas para eliminar");
    if (selectedVentas.length > MAX_DELETE) return showWarn(`Selecciona máximo ${MAX_DELETE.toLocaleString()} para eliminar.`);

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
          const ids = selectedVentas.map((v) => v.id).slice(0, MAX_DELETE);
          await apiFetch(`/ventas-forma-masiva`, {
            method: "DELETE",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(ids),
          });
          showSuccess("Ventas eliminadas correctamente");
          setSelectedVentas([]);
          await (hasAnyApplied ? fetchVentasWithFilters(appliedFilters) : loadVentasPage());
        } catch {
          showError("Error al eliminar las ventas");
        }
      },
    });
  };

  // ✅ CAMBIO: descarga ZIP sin timeout (o puedes poner 30min). Aquí lo dejo SIN timeout.
  const downloadVentasReport = async () => {
    try {
      const qs = new URLSearchParams();
      qs.append("codCliente", COD_CLIENTE_FIJO);

      const { blob, filename } = await apiFetch(`/reporte-ventas-zip?${qs.toString()}`, {
        expect: "blob",
        timeoutMs: null, // <- SIN timeout para evitar cortar ZIP grandes
      });

      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = filename || "fybeca_ventas.zip";
      link.click();
      showInfo("Reporte ZIP descargándose en segundo plano.");
    } catch (e) {
      showError(String(e));
    }
  };

  const downloadFilteredVentasReport = () => {
    const dataToUse = filteredData;
    if (!dataToUse.length) return showWarn("No hay datos filtrados para generar el reporte.");

    const exportData = dataToUse.map((v) => ({
      "Año": v.anio,
      "Mes": monthLabel(v.mes),
      "Día": v.dia,
      "Marca": v.marca || v?.producto?.marca,
      "Cliente": v.codCliente || (v.cliente ? v.cliente.codCliente : COD_CLIENTE_FIJO),
      "Nombre Cliente": v.nombreCliente || (v.cliente ? v.cliente.nombreCliente : "N/A"),
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

  // ===== UI filtros =====
  const handleApplyFilters = () => {
    if (filterMonth !== null && filterMonth !== "" && (filterYear === null || filterYear === "")) {
      showWarn("Para filtrar por Mes, selecciona primero un Año.");
      return;
    }
    const year = filterYear != null && filterYear !== "" ? Number(filterYear) : null;
    const month = filterMonth != null && filterMonth !== "" ? Number(filterMonth) : null;
    const dateFrom = Array.isArray(filterDateRange) ? filterDateRange[0] : null;
    const dateTo = Array.isArray(filterDateRange) ? filterDateRange[1] : null;

    const newApplied = { year, month, marca: filterMarca, dateFrom, dateTo };
    setAppliedFilters(newApplied);
    setGlobalFilter("");
    setShowAll(false);
    fetchVentasWithFilters(newApplied);
  };

  const handleClearFilters = () => {
    setFilterYear(null);
    setFilterMonth(null);
    setFilterMarca("");
    setFilterDateRange(null);
    setGlobalFilter("");
    setMonthsOptions([]);
    setAppliedFilters({ year: null, month: null, marca: "", dateFrom: null, dateTo: null });
    setShowAll(true);
    showInfo("Filtros limpiados correctamente.");
  };

  const onSelectionChange = (e) => {
    const value = e.value || [];
    if (value.length > MAX_DELETE) {
      showWarn(`Solo puede seleccionar un máximo de ${MAX_DELETE.toLocaleString()} registros.`);
      setSelectedVentas(value.slice(0, MAX_DELETE));
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
      showSuccess("Venta actualizada correctamente");
      setEditVenta(null);
      await (hasAnyApplied ? fetchVentasWithFilters(appliedFilters) : loadVentasPage());
    } catch (err) {
      showError(String(err));
    } finally {
      setIsSaving(false);
    }
  };

  const renderHeader = () => (
    <div className="deprati-table-header flex flex-wrap gap-2 align-items-center justify-content-between">
      <h4 className="deprati-title m-0">
        Gestión de Ventas Fybeca
        <small style={{ marginLeft: 8, fontWeight: 400, opacity: 0.8 }}>
          (máx. {MAX_DELETE.toLocaleString()} por eliminación)
        </small>
      </h4>
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
    <div className="flex flex-wrap gap-2">
      <Button
        label={`Eliminar Seleccionados (${selectedVentas.length})`}
        icon="pi pi-trash"
        className="p-button-danger"
        onClick={eliminarVentasSeleccionadas}
        disabled={selectedVentas.length === 0 || selectedVentas.length > MAX_DELETE}
      />
    </div>
  );

  const rightToolbarTemplate = () => (
    <div className="flex flex-wrap gap-2">
      <Button
        label="Importar Excel"
        icon="pi pi-upload"
        className="p-button-help"
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
        label="Descargar Template"
        icon="pi pi-download"
        className="p-button-info"
        onClick={() => {
          const url = encodeURI("/TEMPLATE VENTAS FYBECA.xlsx");
          const link = document.createElement("a");
          link.href = url;
          link.download = "TEMPLATE VENTAS FYBECA.xlsx";
          link.click();
        }}
      />

      <Button
        label="Reporte Ventas (ZIP)"
        icon="pi pi-file"
        className="p-button-success"
        onClick={downloadVentasReport}
        disabled={loadingVentas}
      />

      <Button
        label="Exportar Filtrados"
        icon="pi pi-file-excel"
        className="p-button-success"
        onClick={downloadFilteredVentasReport}
        disabled={!filteredData.length}
      />

      <Button
        label="Guardar Incidencias"
        icon="pi pi-save"
        className="p-button-warning"
        onClick={handleSaveIncidencias}
        disabled={!incidenciasTxt}
        tooltip={incidenciasName || "incidencias_fybeca.txt"}
        tooltipOptions={{ position: "bottom" }}
      />

      <Button
        label="Guardar Log detallado"
        icon="pi pi-save"
        className="p-button-secondary"
        onClick={handleSaveLogDetallado}
        disabled={!logDetalladoTxt}
        tooltip={logDetalladoName || "log_detallado_fybeca.txt"}
        tooltipOptions={{ position: "bottom" }}
      />

      <Button
        label="Guardar No Encontrados"
        icon="pi pi-save"
        className="p-button-help"
        onClick={handleSaveNoEncontrados}
        disabled={!lastErrores?.length}
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

      {/* Overlay de carga */}
      {loadingTemplate && (
        <div className="fixed top-0 left-0 w-full h-full flex justify-content-center align-items-center bg-black-alpha-70 z-5">
          <div className="surface-card p-5 border-round shadow-2 text-center" style={{ minWidth: 360, backgroundColor: "rgba(0,0,0,0.85)" }}>
            <ProgressSpinner style={{ width: "60px", height: "60px" }} />
            <div className="mt-3" style={{ fontWeight: "bold", color: "white", fontSize: "1.2rem" }}>
              Procesando archivo...
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
            {uploadRemainingMs === 0 && (
              <div className="mt-2" style={{ fontSize: "0.9rem", color: "#f8f9fa" }}>
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
                <label className="deprati-label font-bold block mb-2">Año</label>
                <Dropdown
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
                  showClear
                />
              </div>

              <div className="field">
                <label className="deprati-label font-bold block mb-2">Mes</label>
                <Dropdown
                  value={filterMonth}
                  options={monthsOptions}
                  onChange={(e) => setFilterMonth(e.value != null ? Number(e.value) : null)}
                  placeholder={filterYear == null ? "Seleccione primero un Año" : "Seleccionar Mes"}
                  className="deprati-dropdown w-12rem"
                  disabled={filterYear == null || monthsOptions.length === 0}
                  showClear
                />
              </div>

              <div className="field">
                <label className="deprati-label font-bold block mb-2">Marca</label>
                <Dropdown
                  value={filterMarca}
                  options={marcas.map((m) => ({ label: m, value: m }))}
                  onChange={(e) => setFilterMarca(e.value || "")}
                  placeholder="Seleccionar Marca"
                  className="deprati-dropdown w-16rem"
                  showClear
                  filter
                />
              </div>

              <div className="field">
                <label className="deprati-label font-bold block mb-2">Rango de Fecha</label>
                <Calendar
                  value={filterDateRange}
                  onChange={(e) => setFilterDateRange(e.value || null)}
                  dateFormat="dd/mm/yy"
                  selectionMode="range"
                  readOnlyInput
                  placeholder="Seleccione rango de fechas"
                  className="deprati-calendar w-16rem"
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
            rowsPerPageOptions={[50, 100, 150, 200]}
            first={paginatorState.first}
            onPage={onPageChange}
            paginatorClassName="p-3 deprati-square-paginator"
            paginatorTemplate="FirstPageLink PrevPageLink PageLinks NextPageLink LastPageLink RowsPerPageDropdown CurrentPageReport"
            currentPageReportTemplate="Mostrando {first} a {last} de {totalRecords} registros"
            dataKey="id"
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
            tableStyle={{ minWidth: "50rem" }}
            resizableColumns
            columnResizeMode="fit"
          >
            <Column selectionMode="multiple" headerStyle={{ width: "3rem" }} headerCheckbox />
            <Column field="anio" header="Año" sortable />
            <Column field="mes" header="Mes" sortable body={(r) => monthLabel(r.mes)} />
            <Column field="dia" header="Día" sortable />
            <Column field="marca" header="Marca" sortable />
            <Column field="codPdv" header="Código PDV" sortable />
            <Column field="pdv" header="PDV" sortable />
            <Column field="ciudad" header="Ciudad" sortable />
            <Column field="nombreProducto" header="Producto" sortable style={{ minWidth: "18rem" }} />
            <Column field="codBarra" header="Código Barra" sortable />
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

        {/* Diálogo de edición (igual estilo TemplateGeneral) */}
        <Dialog
          key={editVenta?.id || "new"}
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
          style={{ width: "70vw", maxWidth: "1200px" }}
          modal
          closable={false}
          dismissableMask
          breakpoints={{ "960px": "85vw", "641px": "95vw" }}
        >
          <form onSubmit={handleFormSubmit} className="deprati-form p-4" style={{ fontSize: "1.05rem" }}>
            <div className="p-4 mb-5 border-1 border-round surface-card shadow-2">
              <div className="text-lg font-semibold text-primary mb-3">Información General</div>
              <div className="grid formgrid p-fluid gap-4">
                {["anio","mes","dia"].map((id) => (
                  <div key={id} className="col-12 md:col-3">
                    <span className="p-float-label w-full">
                      <InputNumber
                        id={id}
                        value={editVenta?.[id]}
                        onValueChange={(e) => setEditVenta({ ...editVenta, [id]: e.value })}
                        className="w-full"
                        inputStyle={{ fontSize: "1.1rem", padding: "0.85rem", height: "3.2rem" }}
                        useGrouping={false}
                      />
                      <label htmlFor={id} style={{ fontSize: "1rem" }}>{id.toUpperCase()}</label>
                    </span>
                  </div>
                ))}

                <div className="col-12 md:col-3">
                  <span className="p-float-label w-full">
                    <InputText
                      id="marca"
                      value={editVenta?.marca || ""}
                      className={`w-full ${!editVenta?.marca ? "p-invalid" : ""}`}
                      onChange={(e) => setEditVenta({ ...editVenta, marca: e.target.value })}
                      inputStyle={{ fontSize: "1.1rem", padding: "0.85rem", height: "3.2rem" }}
                    />
                    <label htmlFor="marca" style={{ fontSize: "1rem" }}>Marca</label>
                  </span>
                  {!editVenta?.marca && <small className="p-error">La marca es requerida</small>}
                </div>

                {["codPdv","pdv","ciudad"].map((id) => (
                  <div key={id} className="col-12 md:col-4">
                    <span className="p-float-label w-full">
                      <InputText
                        id={id}
                        value={editVenta?.[id] || ""}
                        onChange={(e) => setEditVenta({ ...editVenta, [id]: e.target.value })}
                        className="w-full"
                        inputStyle={{ fontSize: "1.1rem", padding: "0.85rem", height: "3.2rem" }}
                      />
                      <label htmlFor={id} style={{ fontSize: "1rem" }}>{id.toUpperCase()}</label>
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
                      inputStyle={{ fontSize: "1.1rem", padding: "0.85rem", height: "3.2rem" }}
                    />
                    <label htmlFor="nombreProducto" style={{ fontSize: "1rem" }}>Producto</label>
                  </span>
                </div>
                <div className="col-12 md:col-6">
                  <span className="p-float-label w-full">
                    <InputText
                      id="codBarra"
                      value={editVenta?.codBarra || ""}
                      onChange={(e) => setEditVenta({ ...editVenta, codBarra: e.target.value })}
                      className="w-full"
                      inputStyle={{ fontSize: "1.1rem", padding: "0.85rem", height: "3.2rem" }}
                    />
                    <label htmlFor="codBarra" style={{ fontSize: "1rem" }}>Código de Barra</label>
                  </span>
                </div>
              </div>
            </div>

            <div className="p-4 mb-5 border-1 border-round surface-card shadow-2">
              <div className="text-lg font-semibold text-primary mb-3">Información de Stock y Ventas</div>
              <div className="grid formgrid p-fluid gap-3">
                {[
                  { id: "stockDolares", label: "Stock ($)", mode: "decimal" },
                  { id: "stockUnidades", label: "Stock (U)" },
                  { id: "ventaDolares", label: "Venta ($)", mode: "decimal" },
                  { id: "ventaUnidad", label: "Venta (U)" },
                ].map((f) => (
                  <div key={f.id} className="col-12 md:col-4">
                    <span className="p-float-label w-full">
                      <InputNumber
                        id={f.id}
                        value={editVenta?.[f.id]}
                        onValueChange={(e) => setEditVenta({ ...editVenta, [f.id]: e.value })}
                        className="w-full"
                        inputStyle={{ fontSize: "1.1rem", padding: "0.85rem", height: "3.2rem" }}
                        mode={f.mode}
                        minFractionDigits={f.mode === "decimal" ? 2 : undefined}
                      />
                      <label htmlFor={f.id} style={{ fontSize: "1rem" }}>{f.label}</label>
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
                style={{ fontSize: "1.05rem", padding: "0.75rem 1.5rem" }}
              />
              <Button
                label={isSaving ? "Guardando..." : "Guardar"}
                icon={isSaving ? "pi pi-spin pi-spinner" : "pi pi-check"}
                disabled={isSaving}
                type="submit"
                autoFocus
                className="p-button-primary"
                style={{ fontSize: "1.05rem", padding: "0.75rem 1.5rem" }}
              />
            </div>
          </form>
        </Dialog>
      </div>
    </div>
  );
};

export default Fybeca;
