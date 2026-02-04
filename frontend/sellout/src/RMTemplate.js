import React, { useEffect, useMemo, useRef, useState } from "react";
import "./css/deprati.css";
import * as XLSX from "xlsx";

import { Toast } from "primereact/toast";
import { ProgressSpinner } from "primereact/progressspinner";
import { DataTable } from "primereact/datatable";
import { Column } from "primereact/column";
import { Button } from "primereact/button";
import { Dialog } from "primereact/dialog";
import { InputText } from "primereact/inputtext";
import { Dropdown } from "primereact/dropdown";
import { Card } from "primereact/card";
import { Toolbar } from "primereact/toolbar";
import { Divider } from "primereact/divider";
import { ConfirmDialog, confirmDialog } from "primereact/confirmdialog";
import { Calendar } from "primereact/calendar";
import { InputNumber } from "primereact/inputnumber";

import "primereact/resources/themes/lara-light-indigo/theme.css";
import "primereact/resources/primereact.min.css";
import "primeicons/primeicons.css";
import "primeflex/primeflex.css";

// ================= API base =================
const API_BASE = "/api-sellout/rm";

// ======= Límite de eliminación/selección (igual que TemplateGeneral) =======
const MAX_DELETE = 2000;

// ================= Helpers generales =================
const monthNames = [
  "Enero","Febrero","Marzo","Abril","Mayo","Junio",
  "Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre",
];
const monthLabel = (m) => monthNames[(Number(m || 1) - 1)] || m;

const getFilenameFromCD = (cd) => {
  if (!cd) return null;
  const m = /filename\*=UTF-8''([^;\n]+)|filename="?([^";\n]+)"?/i.exec(cd);
  if (m) return decodeURIComponent((m[1] || m[2] || "").trim());
  return null;
};

async function apiFetch(
  path,
  { method = "GET", headers = {}, body, expect = "json", timeoutMs = 300000 } = {}
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
      if (ct.includes("application/json")) {
        const j = await res.json();
        msg = j?.error || j?.message || JSON.stringify(j);
      } else {
        msg = await res.text();
      }
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
      [base, msg && `Detalle: ${msg}`, corr && `Correlation-Id: ${corr}`].filter(Boolean).join(" | ")
    );
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

const secondsFmt = (ms) => `${Math.max(0, Math.round(ms / 1000))}s`;

const estimateUploadTimeMs = (fileSizeBytes) => {
  const fileSizeMB = fileSizeBytes / (1024 * 1024);
  const uploadSpeedMBps = 0.5;
  const baseProcessingMs = 10000;
  const processingPerMBMs = 1000;
  const uploadMs = (fileSizeMB / uploadSpeedMBps) * 1000;
  const processingMs = baseProcessingMs + fileSizeMB * processingPerMBMs;
  const total = (uploadMs + processingMs) * 1.5;
  return Math.min(Math.max(total, 15000), 900000);
};

const formatDuration = (ms) => {
  const totalSec = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  const ss = String(s).padStart(2, "0");
  return m <= 0 ? `${ss}s` : `${m}:${ss} min`;
};

const safeNum = (v, def = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
};

// ====== Logs / guardado manual (igual estilo que TemplateGeneral) ======
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


const buildDetailedLog = ({
  fileName,
  fileSizeBytes = 0,
  estMs = 0,
  elapsedMs = 0,
  counts = { insertadas: 0, actualizadas: 0, ignoradas: 0, conError: 0, total: 0 },
  incidencias = [],
  noEncontrados = [],
}) => {
  const sizeMB = (fileSizeBytes / (1024 * 1024)) || 0;
  const safe = (n) => (Number.isFinite(n) ? n : 0);
  const total = safe(counts.total);
  const elapsedSec = Math.max(1, Math.round(elapsedMs / 1000));
  const tps = total ? (total / elapsedSec).toFixed(2) : "0.00";
  const tpm = total ? (total * 60 / elapsedSec).toFixed(2) : "0.00";

  const lines = [
    "LOG_CARGA_DETALLADO_RM",
    `ARCHIVO: ${fileName || "N/D"}`,
    `TAMANO_MB: ${sizeMB.toFixed(2)}`,
    `TIEMPO_ESTIMADO: ${secondsFmt(estMs)}`,
    `TIEMPO_TRANSCURRIDO_REAL: ${secondsFmt(elapsedMs)}`,
    "",
    "RESUMEN_FILAS:",
    `  INSERTADAS: ${safe(counts.insertadas)}`,
    `  ACTUALIZADAS: ${safe(counts.actualizadas)}`,
    `  IGNORADAS: ${safe(counts.ignoradas)}`,
    `  CON_ERROR: ${safe(counts.conError)}`,
    `  TOTAL: ${total}`,
    "",
    "RENDIMIENTO:",
    `  THROUGHPUT_filas_por_seg: ${tps}`,
    `  THROUGHPUT_filas_por_min: ${tpm}`,
    "",
    "INCIDENCIAS:",
  ];

  const inc = Array.isArray(incidencias) ? incidencias.filter(Boolean) : [];
  if (inc.length) inc.forEach((t) => lines.push(`  ${t}`));
  else lines.push("  (sin incidencias)");

  lines.push("");
  lines.push("CODIGOS_NO_ENCONTRADOS_ORDENADOS:");
  const ne = Array.isArray(noEncontrados) ? noEncontrados.filter(Boolean).map(String) : [];
  if (ne.length) {
    const uniq = Array.from(new Set(ne));
    uniq.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
    uniq.forEach((c) => lines.push(`  ${c}`));
  } else {
    lines.push("  (sin no encontrados)");
  }

  return lines.join("\n");
};

const buildIncidenciasTxt = ({ fileName, counts, noEncontrados = [], incidencias = [] }) => {
  const now = new Date();
  const dd = String(now.getDate()).padStart(2, "0");
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const yyyy = now.getFullYear();
  const HH = String(now.getHours()).padStart(2, "0");
  const MM = String(now.getMinutes()).padStart(2, "0");
  const SS = String(now.getSeconds()).padStart(2, "0");

  const safe = (n) => (Number.isFinite(n) ? n : 0);

  const lines = [
    "INCIDENCIAS_RM",
    `FECHA_HORA: ${yyyy}-${mm}-${dd} ${HH}:${MM}:${SS}`,
    `ARCHIVO: ${fileName || "N/D"}`,
    "",
    "RESUMEN:",
    `  FILAS_LEIDAS: ${safe(counts.total)}`,
    `  FILAS_INSERTADAS: ${safe(counts.insertadas)}`,
    `  FILAS_CON_ERROR: ${safe(counts.conError)}`,
    "",
  ];

  if (noEncontrados?.length) {
    lines.push("CODIGOS_NO_ENCONTRADOS");
    noEncontrados.forEach((c) => lines.push(`(el codigo : ${String(c)}) - No encontrado`));
  } else {
    lines.push("SIN_INCIDENCIAS_DE_CODIGOS_NO_ENCONTRADOS");
  }

  lines.push("");
  lines.push("INCIDENCIAS_SERVIDOR:");
  if (incidencias?.length) incidencias.forEach((t) => lines.push(`  ${String(t)}`));
  else lines.push("  (sin incidencias)");

  return lines.join("\n");
};

// =========================================================
// ======================= COMPONENTE =======================
// =========================================================
const RM = () => {
  const toast = useRef(null);
  const fileInputRef = useRef(null);

  const uploadTimerRef = useRef(null);
  const elapsedTimerRef = useRef(null);

  // data
  const [ventas, setVentas] = useState([]);
  const [loadingVentas, setLoadingVentas] = useState(false);

  // selection / edit
  const [selectedVentas, setSelectedVentas] = useState([]);
  const [editVenta, setEditVenta] = useState(null);

  // filtros (inputs)
  const [filterYear, setFilterYear] = useState(null);
  const [filterMonth, setFilterMonth] = useState(null);
  const [filterMarca, setFilterMarca] = useState("");
  const [filterCliente, setFilterCliente] = useState(null);
  const [filterDateRange, setFilterDateRange] = useState(null);

  // options filtros
  const [yearsOptions, setYearsOptions] = useState([]);
  const [monthsOptions, setMonthsOptions] = useState([]);
  const [marcas, setMarcas] = useState([]);
  const [clientesOptions, setClientesOptions] = useState([]);

  // filtros aplicados (los que realmente usan GET)
  const [appliedFilters, setAppliedFilters] = useState({
    year: null,
    month: null,
    marca: "",
    cliente: null,
    dateFrom: null,
    dateTo: null,
  });

  const [globalFilter, setGlobalFilter] = useState("");

  // paginación igual que TemplateGeneral
  const [paginatorState, setPaginatorState] = useState({
    first: 0,
    rows: 50,
    page: 0,
    totalRecords: 0,
  });

  // overlay upload
  const [loadingTemplate, setLoadingTemplate] = useState(false);
  const [uploadRemainingMs, setUploadRemainingMs] = useState(null);
  const [uploadElapsedMs, setUploadElapsedMs] = useState(0);

  // logs manuales
  const [logIncidenciasTxt, setLogIncidenciasTxt] = useState(null);
  const [logIncidenciasName, setLogIncidenciasName] = useState(null);
  const [logDetalladoTxt, setLogDetalladoTxt] = useState(null);
  const [logDetalladoName, setLogDetalladoName] = useState(null);

  // ===== Toast helpers (mismo estilo base) =====
  const showToast = ({ type = "info", summary, detail, life = 3500, sticky, content }) => {
    if (!toast.current) return;
    toast.current.show({ severity: type, summary, detail, life, sticky, content });
  };
  const showSuccess = (m) => showToast({ type: "success", summary: "Éxito", detail: m });
  const showInfo = (m) => showToast({ type: "info", summary: "Información", detail: m });
  const showWarn = (m) => showToast({ type: "warn", summary: "Advertencia", detail: m });
  const showError = (m) => showToast({ type: "error", summary: "Error", detail: m, life: 8000 });

  // ===== timers overlay (igual que TemplateGeneral) =====
  useEffect(() => {
    if (uploadRemainingMs == null) return;
    if (uploadTimerRef.current) clearInterval(uploadTimerRef.current);
    uploadTimerRef.current = setInterval(() => {
      setUploadRemainingMs((ms) => {
        if (ms == null) return null;
        const next = ms - 1000;
        return next > 0 ? next : 0;
      });
    }, 1000);
    return () => {
      if (uploadTimerRef.current) {
        clearInterval(uploadTimerRef.current);
        uploadTimerRef.current = null;
      }
    };
  }, [uploadRemainingMs != null]);

  useEffect(() => {
    if (!loadingTemplate) return;
    if (elapsedTimerRef.current) clearInterval(elapsedTimerRef.current);
    elapsedTimerRef.current = setInterval(() => setUploadElapsedMs((ms) => ms + 1000), 1000);
    return () => {
      if (elapsedTimerRef.current) {
        clearInterval(elapsedTimerRef.current);
        elapsedTimerRef.current = null;
      }
    };
  }, [loadingTemplate]);

  // ===== Helpers de filtros/query =====
  const hasAnyApplied = useMemo(
    () =>
      appliedFilters.year !== null ||
      appliedFilters.month !== null ||
      !!appliedFilters.marca ||
      !!appliedFilters.cliente ||
      !!appliedFilters.dateFrom ||
      !!appliedFilters.dateTo,
    [appliedFilters]
  );

  const buildQuery = (f) => {
    const params = new URLSearchParams();
    if (f.cliente) params.set("codCliente", String(f.cliente)); // si RM lo soporta
    if (f.year !== null) params.set("anio", String(f.year));
    if (f.month !== null) params.set("mes", String(f.month));
    if (f.marca) params.set("marca", f.marca);

    // fechas (si RM no lo usa, no afecta)
    if (f.dateFrom) {
      const d = new Date(f.dateFrom);
      params.set(
        "fechaDesde",
        `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
      );
    }
    if (f.dateTo) {
      const d = new Date(f.dateTo);
      params.set(
        "fechaHasta",
        `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
      );
    }

    // compat
    params.set("limit", "10000");
    params.set("offset", "0");
    return params.toString();
  };

  const filterLocalData = (data, f) => {
    return (data || []).filter((item) => {
      if (f.year !== null && Number(item.anio) !== Number(f.year)) return false;
      if (f.month !== null && Number(item.mes) !== Number(f.month)) return false;
      if (f.marca && (item.marca ?? item?.producto?.marca) !== f.marca) return false;

      if (f.cliente) {
        const cod = item.codCliente ?? (item.cliente ? item.cliente.codCliente : null);
        if (!cod || String(cod) !== String(f.cliente)) return false;
      }

      if (f.dateFrom || f.dateTo) {
        const itemDate = new Date(Number(item.anio), Number(item.mes) - 1, Number(item.dia || 1));
        if (f.dateFrom) {
          const d = new Date(f.dateFrom);
          const from = new Date(d.getFullYear(), d.getMonth(), d.getDate());
          if (itemDate < from) return false;
        }
        if (f.dateTo) {
          const d = new Date(f.dateTo);
          const to = new Date(d.getFullYear(), d.getMonth(), d.getDate());
          if (itemDate > to) return false;
        }
      }
      return true;
    });
  };

  // ===== Loads options auxiliares (marcas/años/meses/clientes) =====
  const loadClientesOptions = async () => {
    try {
      const res = await fetch("/api-sellout/clientes/empresas", { method: "GET" });
      if (!res.ok) throw new Error("No se pudo cargar la lista de clientes");
      const data = await res.json();
      const list = Array.isArray(data) ? data : [];
      const opts = list
        .map((c) => {
          const cod = c?.codCliente ?? c?.cod_Cliente ?? c?.cliente ?? c?.codigo ?? null;
          const nom = c?.nombreCliente ?? c?.nombre_Cliente ?? c?.nombre ?? null;
          if (!cod) return null;
          const label = nom ? `${String(cod)} - ${String(nom)}` : String(cod);
          return { label, value: String(cod) };
        })
        .filter(Boolean);
      setClientesOptions(opts);
    } catch {
      // fallback: se llenará desde ventas
      setClientesOptions([]);
    }
  };

  const rebuildFilterOptionsFromVentas = (list) => {
    const years = [...new Set((list || []).map((v) => Number(v?.anio)).filter(Number.isFinite))].sort((a, b) => a - b);
    setYearsOptions(years.map((y) => ({ label: String(y), value: y })));

    const marcasList = [...new Set((list || []).map((v) => String(v?.marca || "").trim()).filter(Boolean))].sort();
    setMarcas(marcasList);

    // meses depende del año seleccionado
    // (se actualizará en loadMonthsOptions)
    if (!clientesOptions?.length) {
      const map = new Map();
      (list || []).forEach((v) => {
        const code = v?.codCliente ?? (v?.cliente ? v.cliente.codCliente : null);
        const name = v?.nombreCliente ?? (v?.cliente ? v.cliente.nombreCliente : null);
        if (code) map.set(String(code), name ? String(name) : String(code));
      });
      const opts = Array.from(map.entries()).map(([value, label]) => ({ label: `${value} - ${label}`, value }));
      if (opts.length) setClientesOptions(opts);
    }
  };

  const loadMonthsOptions = async (anio) => {
    if (anio == null || !Number.isFinite(anio)) {
      setMonthsOptions([]);
      return;
    }
    // RM no tiene endpoint de meses en tu código; lo hacemos por dataset (igual fallback del TemplateGeneral)
    const months = [
      ...new Set(ventas.filter((v) => Number(v.anio) === Number(anio)).map((v) => Number(v.mes))),
    ]
      .filter((m) => Number.isFinite(m) && m >= 1 && m <= 12)
      .sort((a, b) => a - b);

    const opts = (months.length ? months : Array.from({ length: 12 }, (_, i) => i + 1)).map((m) => ({
      label: monthLabel(m),
      value: m,
    }));
    setMonthsOptions(opts);
  };

  // ===== carga ventas =====
  const loadVentas = async () => {
    setLoadingVentas(true);
    try {
      const qs = buildQuery(appliedFilters);
      const { data } = await apiFetch(`/ventas?${qs}`);
      const list = Array.isArray(data) ? data : [];
      list._fromApi = true;
      setVentas(list);
      setPaginatorState((p) => ({ ...p, first: 0, page: 0, totalRecords: list.length }));
      rebuildFilterOptionsFromVentas(list);
    } catch (e) {
      showError(String(e));
      setVentas([]);
      setPaginatorState((p) => ({ ...p, first: 0, page: 0, totalRecords: 0 }));
    } finally {
      setLoadingVentas(false);
    }
  };

  const fetchVentasWithFilters = async (f) => {
    setLoadingVentas(true);
    try {
      const qs = buildQuery(f);
      const { data } = await apiFetch(`/ventas?${qs}`);
      const list = Array.isArray(data) ? data : [];
      list._fromApi = true;
      setVentas(list);
      setPaginatorState((p) => ({ ...p, first: 0, page: 0, totalRecords: list.length }));
      rebuildFilterOptionsFromVentas(list);
      showSuccess(`Se encontraron ${list.length} registros con los filtros aplicados.`);
    } catch (e) {
      console.error(e);
      showWarn("No se pudo conectar a la API. Aplicando filtros localmente...");
      const filteredLocal = filterLocalData(ventas, f);
      setVentas(filteredLocal);
      setPaginatorState((p) => ({ ...p, first: 0, page: 0, totalRecords: filteredLocal.length }));
      showInfo(`Se encontraron ${filteredLocal.length} registros con los filtros aplicados localmente.`);
    } finally {
      setLoadingVentas(false);
    }
  };

  useEffect(() => {
    loadClientesOptions();
    // carga inicial sin filtros
    loadVentas();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // reset paginación cuando cambia filtro aplicado o global search
  useEffect(() => {
    setPaginatorState((p) => ({ ...p, first: 0, page: 0 }));
  }, [appliedFilters, globalFilter]);

  // ===== DataTable filtrada =====
  const filteredData = useMemo(() => {
    let base = [...ventas];
    if (hasAnyApplied && !base._fromApi) base = filterLocalData(base, appliedFilters);

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
  }, [ventas, hasAnyApplied, appliedFilters, globalFilter]);

  // ===== Import Excel RM (mismo flow de UI que TemplateGeneral) =====
  const cargarExcelRM = async (file) => {
    if (!file) return showWarn("No seleccionaste ningún archivo.");
    const ext = file.name.split(".").pop().toLowerCase();
    if (!["xlsx", "xls"].includes(ext)) return showError("Tipo de archivo no soportado. Sube un Excel (.xlsx o .xls).");

    setLoadingTemplate(true);
    setUploadElapsedMs(0);

    // limpiar logs previos
    setLogIncidenciasTxt(null);
    setLogIncidenciasName(null);
    setLogDetalladoTxt(null);
    setLogDetalladoName(null);

    const controllerTimeoutMs = 30 * 60 * 1000;
    const estMs = estimateUploadTimeMs(file.size);
    setUploadRemainingMs(estMs);

    toast.current?.show({
      severity: "info",
      summary: "Cargando archivo",
      detail: `Subiendo ${file.name}. Tiempo estimado inicial: ${formatDuration(estMs)}.`,
      life: 4000,
    });

    const start = performance.now();

    try {
      const formData = new FormData();
      formData.append("file", file);
      // si quieres que el filtro cliente se mande al upload, lo mandamos si está aplicado
      if (appliedFilters?.cliente) formData.append("codCliente", String(appliedFilters.cliente));

      // RM controller: POST /api-sellout/rm/subir-archivo-venta (JSON)
      const res = await fetch(`${API_BASE}/subir-archivo-venta`, {
        method: "POST",
        body: formData,
        signal: AbortSignal.timeout(controllerTimeoutMs),
      });

      if (!res.ok) {
        let msg = "";
        try {
          const ct = res.headers.get("Content-Type") || "";
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

      // RM suele devolver: ok, filasLeidasVentas, filasProcesadasVentas, filasLeidasStock, filasProcesadasStock,
      // codigosNoEncontrados, incidencias
      const ok = !!result?.ok;

      const filasLV = safeNum(result?.filasLeidasVentas, 0);
      const filasPV = safeNum(result?.filasProcesadasVentas, 0);
      const filasLS = safeNum(result?.filasLeidasStock, 0);
      const filasPS = safeNum(result?.filasProcesadasStock, 0);

      const noEncontrados = Array.isArray(result?.codigosNoEncontrados) ? result.codigosNoEncontrados : [];
      const incidenciasServidor = Array.isArray(result?.incidencias) ? result.incidencias : [];

      // armamos logs para guardado manual
      const counts = {
        insertadas: filasPV + filasPS,
        actualizadas: 0,
        ignoradas: 0,
        conError: (incidenciasServidor?.length || 0) + (noEncontrados?.length || 0),
        total: (filasLV + filasLS) || (filasPV + filasPS),
      };

      const now = new Date();
      const fechaStr = now.toISOString().replace(/[:T]/g, "-").split(".")[0];

      const incidenciasTxt = buildIncidenciasTxt({
        fileName: file.name,
        counts,
        noEncontrados,
        incidencias: incidenciasServidor,
      });
      setLogIncidenciasTxt(incidenciasTxt);
      setLogIncidenciasName(`incidencias_rm_${fechaStr}.txt`);

      const end = performance.now();
      const elapsedMs = Math.max(0, Math.round(end - start));

      const detailed = buildDetailedLog({
        fileName: file.name,
        fileSizeBytes: file.size,
        estMs,
        elapsedMs,
        counts,
        incidencias: incidenciasServidor,
        noEncontrados,
      });
      setLogDetalladoTxt(detailed);
      setLogDetalladoName(`log_detallado_rm_${fechaStr}.txt`);

      // recargar ventas (con filtros aplicados)
      await (hasAnyApplied ? fetchVentasWithFilters(appliedFilters) : loadVentas());

      // toast final sticky como TemplateGeneral
      toast.current?.show({
        severity: (!ok || counts.conError) ? "warn" : "success",
        summary: "Carga finalizada",
        sticky: true,
        detail: (
          <div className="flex flex-column gap-2" style={{ lineHeight: 1.4 }}>
            <div>
              <b>Listo:</b> ahora puedes guardar los archivos desde los botones{" "}
              <b>Guardar Incidencias</b> y <b>Guardar Log detallado</b> en la barra.
            </div>

            <div>
              <b>Ventas:</b> leídas {filasLV} / procesadas {filasPV}
              <br />
              <b>Stock:</b> leídas {filasLS} / procesadas {filasPS}
              <br />
              <b>No encontrados:</b> {noEncontrados.length} | <b>Incidencias:</b> {incidenciasServidor.length}
            </div>

            {incidenciasServidor?.length > 0 && (
              <div style={{ marginTop: "0.5rem" }}>
                <div className="font-bold">Incidencias reportadas por el servidor:</div>
                <ul style={{ margin: 0, paddingLeft: "1.25rem" }}>
                  {incidenciasServidor.slice(0, 5).map((t, i) => (
                    <li key={i} style={{ whiteSpace: "pre-wrap" }}>{String(t)}</li>
                  ))}
                  {incidenciasServidor.length > 5 && <li>... ({incidenciasServidor.length - 5} más)</li>}
                </ul>
              </div>
            )}
          </div>
        ),
      });

    } catch (e) {
      showError(String(e?.message || e));
    } finally {
      setUploadRemainingMs(null);
      setLoadingTemplate(false);

      if (uploadTimerRef.current) {
        clearInterval(uploadTimerRef.current);
        uploadTimerRef.current = null;
      }
      if (elapsedTimerRef.current) {
        clearInterval(elapsedTimerRef.current);
        elapsedTimerRef.current = null;
      }
    }
  };

  // ===== Guardado manual de logs (mismo que TemplateGeneral) =====
  const handleSaveIncidencias = async () => {
    if (!logIncidenciasTxt) return showWarn("No hay incidencias generadas todavía.");
    try {
      const ok = await saveTextFile(logIncidenciasTxt, logIncidenciasName || "incidencias_rm.txt");
      if (ok) showSuccess("Incidencias guardadas.");
    } catch {
      showError("No se pudo guardar el archivo de incidencias.");
    }
  };

  const handleSaveLogDetallado = async () => {
    if (!logDetalladoTxt) return showWarn("No hay log detallado generado todavía.");
    try {
      const ok = await saveTextFile(logDetalladoTxt, logDetalladoName || "log_detallado_rm.txt");
      if (ok) showSuccess("Log detallado guardado.");
    } catch {
      showError("No se pudo guardar el log detallado.");
    }
  };

  // ===== CRUD =====
  const openEdit = async (rowData) => {
    try {
      const qs = new URLSearchParams();
      // si el backend necesita codCliente, se lo pasamos si está aplicado
      if (appliedFilters?.cliente) qs.set("codCliente", String(appliedFilters.cliente));
      const { data } = await apiFetch(`/venta/${rowData.id}${qs.toString() ? `?${qs.toString()}` : ""}`);
      setEditVenta(data);
    } catch (e) {
      showError(String(e));
    }
  };

  const actualizarVenta = async (venta) => {
    try {
      const qs = new URLSearchParams();
      if (appliedFilters?.cliente) qs.set("codCliente", String(appliedFilters.cliente));

      await apiFetch(`/venta/${venta.id}${qs.toString() ? `?${qs.toString()}` : ""}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(venta),
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
          const qs = new URLSearchParams();
          if (appliedFilters?.cliente) qs.set("codCliente", String(appliedFilters.cliente));
          await apiFetch(`/venta/${id}${qs.toString() ? `?${qs.toString()}` : ""}`, { method: "DELETE" });
          showSuccess("Venta eliminada correctamente");
          await (hasAnyApplied ? fetchVentasWithFilters(appliedFilters) : loadVentas());
        } catch (e) {
          showError(String(e));
        }
      },
    });
  };

  const eliminarVentasSeleccionadas = () => {
    if (selectedVentas.length === 0) return showInfo("No hay ventas seleccionadas para eliminar");
    if (selectedVentas.length > MAX_DELETE) return showWarn(`Selecciona como máximo ${MAX_DELETE.toLocaleString()} registros por eliminación.`);

    confirmDialog({
      message: `¿Está seguro de eliminar ${selectedVentas.length.toLocaleString()} venta(s)?`,
      header: "Confirmación de eliminación",
      icon: "pi pi-exclamation-triangle",
      acceptLabel: "Sí, eliminar",
      rejectLabel: "No, cancelar",
      acceptClassName: "p-button-danger",
      closable: false,
      accept: async () => {
        try {
          const ids = selectedVentas.map((v) => v.id).filter(Boolean);
          // chunk igual al otro JS
          const chunkSize = 2000;
          const qs = new URLSearchParams();
          if (appliedFilters?.cliente) qs.set("codCliente", String(appliedFilters.cliente));

          for (let i = 0; i < ids.length; i += chunkSize) {
            const slice = ids.slice(i, i + chunkSize);
            await apiFetch(`/ventas-forma-masiva${qs.toString() ? `?${qs.toString()}` : ""}`, {
              method: "DELETE",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(slice),
            });
          }
          showSuccess("Ventas eliminadas correctamente");
          setSelectedVentas([]);
          await (hasAnyApplied ? fetchVentasWithFilters(appliedFilters) : loadVentas());
        } catch (e) {
          showError("Error al eliminar las ventas");
        }
      },
    });
  };

  // ===== Reporte backend (igual botón TemplateGeneral) =====
  const downloadVentasReport = async () => {
    try {
      const { blob, filename } = await apiFetch("/reporte-ventas", { expect: "blob" });
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = filename || "reporte_ventas_rm.xlsx";
      link.click();
      showInfo("Reporte general descargándose en segundo plano.");
    } catch (e) {
      showError(String(e));
    }
  };

  // ===== Exportar Filtrados (igual idea TemplateGeneral) =====
  const downloadFilteredVentasReport = () => {
    const dataTable = filteredData.length ? filteredData : ventas;
    if (!dataTable.length) return showWarn("No hay datos para generar el reporte.");

    const exportData = dataTable.map((v) => ({
      "Año": v.anio,
      "Mes": monthLabel(v.mes),
      "Día": v.dia,
      "Marca": v.marca,
      "Cliente": v.codCliente || (v.cliente ? v.cliente.codCliente : "N/A"),
      "Nombre Cliente": v.nombreCliente || (v.cliente ? v.cliente.nombreCliente : "N/A"),
      "Código Barra": v.codBarra,
      "Código SAP": v.codigoSap,
      "Producto": v.nombreProducto,
      "Código PDV": v.codPdv,
      "PDV": v.pdv,
      "Ciudad": v.ciudad || (v.cliente ? v.cliente.ciudad : "N/A"),
      "Stock ($)": safeNum(v.stockDolares ?? 0),
      "Stock (U)": safeNum(v.stockUnidades ?? 0),
      "Venta ($)": safeNum(v.ventaDolares ?? 0),
      "Venta (U)": safeNum(v.ventaUnidad ?? 0),
    }));

    const ws = XLSX.utils.json_to_sheet(exportData);
    const numCols = ["M", "N", "O", "P"];
    for (let i = 2; i <= exportData.length + 1; i++) {
      numCols.forEach((col) => {
        const cell = ws[`${col}${i}`];
        if (cell) cell.z = "#,##0.00";
      });
    }

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "RM Filtradas");

    const today = new Date();
    const dateStr = `${today.getDate()}-${today.getMonth() + 1}-${today.getFullYear()}`;
    let fileName = "Reporte_Ventas_RM_";
    if (Number.isFinite(appliedFilters.year)) fileName += `${appliedFilters.year}_`;
    if (Number.isFinite(appliedFilters.month)) fileName += `${monthLabel(appliedFilters.month)}_`;
    if (appliedFilters.marca) fileName += `${appliedFilters.marca}_`;
    fileName += dateStr + ".xlsx";

    XLSX.writeFile(wb, fileName);
    showSuccess(`Se ha generado el reporte con ${exportData.length} registros.`);
  };

  // ===== filtros UI (aplicar/limpiar igual TemplateGeneral) =====
  const handleApplyFilters = async () => {
    if (filterMonth !== null && filterYear === null) {
      showWarn("Para filtrar por Mes, selecciona primero un Año.");
      return;
    }
    const dateFrom = Array.isArray(filterDateRange) ? filterDateRange[0] : null;
    const dateTo = Array.isArray(filterDateRange) ? filterDateRange[1] : null;

    const newApplied = {
      year: filterYear,
      month: filterMonth,
      marca: filterMarca,
      cliente: filterCliente,
      dateFrom,
      dateTo,
    };
    setAppliedFilters(newApplied);
    setGlobalFilter("");
    await fetchVentasWithFilters(newApplied);
  };

  const handleClearFilters = async () => {
    setFilterYear(null);
    setFilterMonth(null);
    setFilterMarca("");
    setFilterCliente(null);
    setFilterDateRange(null);
    setGlobalFilter("");
    setMonthsOptions([]);
    setAppliedFilters({ year: null, month: null, marca: "", cliente: null, dateFrom: null, dateTo: null });
    await loadVentas();
    showInfo("Filtros limpiados correctamente.");
  };

  const onSelectionChange = (e) => {
    const next = Array.isArray(e.value) ? e.value : [];
    if (next.length > MAX_DELETE) {
      setSelectedVentas(next.slice(0, MAX_DELETE));
      showWarn(`Solo puedes seleccionar hasta ${MAX_DELETE.toLocaleString()} registros para eliminar.`);
    } else {
      setSelectedVentas(next);
    }
  };

  const onPageChange = async (e) => {
    setPaginatorState((p) => ({ ...p, first: e.first, rows: e.rows }));
  };

  return (
    <div className="fybeca-container">
      <Toast ref={toast} position="top-right" />
      <ConfirmDialog />

      <div className="grid">
        <div className="col-12">
          <div className="card">
            <h1 className="text-center mb-4">RM — Ventas</h1>

            <Toolbar
              className="mb-4"
              left={
                <div className="flex flex-wrap gap-2">
                  <Button
                    label={`Eliminar Seleccionados (${selectedVentas.length})`}
                    icon="pi pi-trash"
                    className="p-button-danger"
                    onClick={eliminarVentasSeleccionadas}
                    disabled={selectedVentas.length === 0 || selectedVentas.length > MAX_DELETE}
                  />
                </div>
              }
              right={
                <div className="flex flex-wrap gap-2">
                  <Button
                    label="Importar Excel"
                    icon="pi pi-upload"
                    className="p-button-help"
                    onClick={() => fileInputRef.current.click()}
                  />
                  <input
                    type="file"
                    accept=".xlsx,.xls"
                    onChange={(e) => {
                      if (e.target.files.length > 0) {
                        cargarExcelRM(e.target.files[0]);
                        e.target.value = "";
                      }
                    }}
                    ref={fileInputRef}
                    style={{ display: "none" }}
                  />

                  <Button
                    label="Descargar Template"
                    icon="pi pi-download"
                    className="p-button-info"
                    onClick={() => (window.location.href = "/TEMPLATE TIENDEC.xlsx")}
                  />

                  <Button
                    label="Reporte Ventas"
                    icon="pi pi-file-excel"
                    className="p-button-success"
                    onClick={downloadVentasReport}
                    disabled={loadingVentas}
                  />

                  <Button
                    label="Exportar Filtrados"
                    icon="pi pi-file-excel"
                    className="p-button-success"
                    onClick={downloadFilteredVentasReport}
                  />

                  <Button
                    label="Guardar Incidencias"
                    icon="pi pi-save"
                    className="p-button-warning"
                    onClick={handleSaveIncidencias}
                    disabled={!logIncidenciasTxt}
                    tooltip={logIncidenciasName || "incidencias_rm.txt"}
                    tooltipOptions={{ position: "bottom" }}
                  />

                  <Button
                    label="Guardar Log detallado"
                    icon="pi pi-save"
                    className="p-button-secondary"
                    onClick={handleSaveLogDetallado}
                    disabled={!logDetalladoTxt}
                    tooltip={logDetalladoName || "log_detallado_rm.txt"}
                    tooltipOptions={{ position: "bottom" }}
                  />
                </div>
              }
            />

            <Card className="deprati-filter-card mb-3">
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
                    <label htmlFor="filterCliente" className="deprati-label font-bold block mb-2">
                      Cliente
                    </label>
                    <Dropdown
                      id="filterCliente"
                      value={filterCliente}
                      options={clientesOptions}
                      onChange={(e) => setFilterCliente(e.value)}
                      placeholder="Seleccionar Cliente"
                      className="deprati-dropdown w-16rem"
                    />
                  </div>

                  <div className="field">
                    <label htmlFor="filterDateRange" className="deprati-label font-bold block mb-2">
                      Rango de Fecha
                    </label>
                    <Calendar
                      id="filterDateRange"
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

            <DataTable
              value={filteredData}
              loading={loadingVentas}
              paginator
              rows={paginatorState.rows}
              rowsPerPageOptions={[50, 100, 150, 200]}
              first={paginatorState.first}
              onPage={onPageChange}
              paginatorClassName="p-3 deprati-square-paginator"
              paginatorTemplate="FirstPageLink PrevPageLink PageLinks NextPageLink LastPageLink RowsPerPageDropdown CurrentPageReport"
              currentPageReportTemplate="Mostrando {first} a {last} de {totalRecords} registros"
              responsiveLayout="scroll"
              emptyMessage="No hay ventas disponibles."
              className="p-datatable-sm"
              showGridlines
              stripedRows
              selection={selectedVentas}
              onSelectionChange={onSelectionChange}
              dataKey="id"
              header={
                <div className="deprati-table-header flex flex-wrap gap-2 align-items-center justify-content-between">
                  <h4 className="deprati-title m-0">
                    Listado de Ventas
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
              }
            >
              <Column selectionMode="multiple" headerStyle={{ width: "3em" }} headerCheckbox />
              <Column field="anio" header="Año" sortable />
              <Column field="mes" header="Mes" sortable body={(r) => monthLabel(r.mes)} />
              <Column field="dia" header="Día" sortable />
              <Column field="marca" header="Marca" sortable />
              <Column field="codBarra" header="Código Barra" sortable />
              <Column field="codigoSap" header="Código SAP" sortable />
              <Column field="nombreProducto" header="Producto" sortable />
              <Column field="codPdv" header="Código PDV" sortable />
              <Column field="pdv" header="PDV" sortable />
              <Column
                field="ciudad"
                header="Ciudad"
                sortable
                body={(r) => r.ciudad || (r.cliente ? r.cliente.ciudad : "N/A")}
              />
              <Column field="ventaUnidad" header="Venta Unidades" sortable body={(r) => safeNum(r.ventaUnidad ?? 0)} />
              <Column field="ventaDolares" header="Venta $" sortable body={(r) => safeNum(r.ventaDolares ?? 0).toFixed(2)} />
              <Column field="stockUnidades" header="Stock Unidades" sortable body={(r) => safeNum(r.stockUnidades ?? 0)} />
              <Column field="stockDolares" header="Stock $" sortable body={(r) => safeNum(r.stockDolares ?? 0).toFixed(2)} />
              <Column
                header="Acciones"
                body={(rowData) => (
                  <div className="flex gap-2 justify-content-center">
                    <Button
                      icon="pi pi-pencil"
                      className="p-button-rounded p-button-success p-button-outlined"
                      onClick={() => openEdit(rowData)}
                      tooltip="Editar"
                    />
                    <Button
                      icon="pi pi-trash"
                      className="p-button-rounded p-button-danger p-button-outlined"
                      onClick={() => eliminarVenta(rowData.id)}
                      tooltip="Eliminar"
                    />
                  </div>
                )}
                style={{ width: "8em" }}
              />
            </DataTable>
          </div>
        </div>
      </div>

      {loadingTemplate && (
        <div className="fixed top-0 left-0 w-full h-full flex justify-content-center align-items-center bg-black-alpha-60 z-5">
          <div className="surface-card p-5 border-round shadow-2 text-center" style={{ minWidth: 340 }}>
            <ProgressSpinner style={{ width: "50px", height: "50px" }} />
            <div className="mt-3" style={{ fontWeight: 600 }}>Procesando archivo...</div>
            <div className="mt-2" style={{ fontSize: "0.95rem", opacity: 0.9 }}>
              {uploadRemainingMs != null
                ? <>Tiempo restante estimado:&nbsp;<span style={{ fontFamily: "monospace" }}>{formatDuration(uploadRemainingMs)}</span></>
                : "Calculando tiempo estimado..."}
            </div>
            <div className="mt-2" style={{ fontSize: "0.95rem", opacity: 0.9 }}>
              Tiempo transcurrido:&nbsp;
              <span style={{ fontFamily: "monospace" }}>{formatDuration(uploadElapsedMs)}</span>
            </div>
            {uploadRemainingMs === 0 && (
              <div className="mt-2" style={{ fontSize: "0.9rem", color: "#6c757d" }}>
                Casi listo… finalizando procesamiento del servidor
              </div>
            )}
          </div>
        </div>
      )}

      <Dialog
        key={editVenta?.id || "new"}
        visible={!!editVenta}
        onHide={() => setEditVenta(null)}
        modal
        closable={false}
        dismissableMask
        className="deprati-edit-dialog p-fluid surface-overlay shadow-3"
        style={{ width: "70vw", maxWidth: "1200px" }}
        breakpoints={{ "960px": "85vw", "641px": "95vw" }}
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
        footer={
          <div className="flex justify-content-end gap-2 mt-4 pt-4 border-top-1 border-300 bg-gray-100 p-3 border-round-bottom">
            <Button
              label="Cancelar"
              icon="pi pi-times"
              className="p-button-outlined p-button-secondary"
              onClick={() => setEditVenta(null)}
              type="button"
              style={{ fontSize: "1.05rem", padding: "0.75rem 1.5rem" }}
            />
            <Button
              label="Guardar"
              icon="pi pi-check"
              onClick={() => actualizarVenta(editVenta)}
              className="p-button-primary"
              style={{ fontSize: "1.05rem", padding: "0.75rem 1.5rem" }}
            />
          </div>
        }
      >
        {editVenta && (
          <div className="p-4" style={{ fontSize: "1.05rem" }}>
            <div className="p-4 mb-5 border-1 border-round surface-card shadow-2">
              <div className="text-lg font-semibold text-primary mb-3">Información General</div>
              <div className="grid formgrid p-fluid gap-4">
                {["anio", "mes", "dia"].map((id) => (
                  <div key={id} className="col-12 md:col-3">
                    <span className="p-float-label w-full">
                      <InputNumber
                        id={id}
                        value={editVenta[id]}
                        onValueChange={(e) => setEditVenta({ ...editVenta, [id]: e.value })}
                        className="w-full"
                        inputStyle={{ fontSize: "1.1rem", padding: "0.85rem", height: "3.2rem" }}
                        useGrouping={false}
                      />
                      <label htmlFor={id} style={{ fontSize: "1rem" }}>
                        {id.charAt(0).toUpperCase() + id.slice(1)}
                      </label>
                    </span>
                  </div>
                ))}

                <div className="col-12 md:col-3">
                  <span className="p-float-label w-full">
                    <Dropdown
                      id="marca"
                      value={editVenta.marca}
                      options={marcas.map((m) => ({ label: m, value: m }))}
                      onChange={(e) => setEditVenta({ ...editVenta, marca: e.value })}
                      placeholder="Seleccionar Marca"
                      className={`w-full custom-dropdown ${!editVenta?.marca ? "p-invalid" : ""}`}
                    />
                    <label htmlFor="marca" style={{ fontSize: "1rem" }}>
                      Marca
                    </label>
                  </span>
                  {!editVenta?.marca && <small className="p-error">La marca es requerida</small>}
                </div>

                {["codPdv", "pdv", "ciudad"].map((id) => (
                  <div key={id} className="col-12 md:col-4">
                    <span className="p-float-label w-full">
                      <InputText
                        id={id}
                        value={editVenta[id] || ""}
                        onChange={(e) => setEditVenta({ ...editVenta, [id]: e.target.value })}
                        className="w-full"
                        inputStyle={{ fontSize: "0.85rem", padding: "0.85rem", height: "3.2rem" }}
                      />
                      <label htmlFor={id} style={{ fontSize: "1rem" }}>
                        {id.toUpperCase()}
                      </label>
                    </span>
                  </div>
                ))}
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
                ].map(({ id, label, mode }) => (
                  <div key={id} className="col-12 md:col-4">
                    <span className="p-float-label w-full">
                      <InputNumber
                        id={id}
                        value={editVenta[id]}
                        onValueChange={(e) => setEditVenta({ ...editVenta, [id]: e.value })}
                        className="w-full"
                        inputStyle={{ fontSize: "1.1rem", padding: "0.85rem", height: "3.2rem" }}
                        useGrouping={false}
                        mode={mode}
                        minFractionDigits={mode === "decimal" ? 2 : 0}
                        maxFractionDigits={mode === "decimal" ? 2 : 0}
                      />
                      <label htmlFor={id} style={{ fontSize: "1rem" }}>
                        {label}
                      </label>
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </Dialog>
    </div>
  );
};

export default RM;
