
import React, { useEffect, useState, useRef, useMemo } from "react";
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

// ================= API base y helper fetch =================
const API_BASE = "/api-sellout/template-general";

const getFilenameFromCD = (cd) => {
  if (!cd) return null;
  const m = /filename\*=UTF-8''([^;\n]+)|filename="?([^";\n]+)"?/i.exec(cd);
  if (m) return decodeURIComponent((m[1] || m[2] || "").trim());
  return null;
};

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

// ================= Utilidades varias =================
const monthNames = [
  "Enero","Febrero","Marzo","Abril","Mayo","Junio",
  "Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre",
];
const monthLabel = (m) => monthNames[(Number(m || 1) - 1)] || m;

// ======= Límite de eliminación/selección =======
const MAX_DELETE = 2000;

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
  if (Array.isArray(result?.noEncontrados)) {
    return result.noEncontrados.map((x) => toObj(x, "No encontrado"));
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
    "filasInsertadas","insertadas","inserted","inserts","created","insertados"
  ]);
  const actualizadas = possible(src, [
    "filasActualizadas","actualizadas","updated","updates","upserts","actualizados"
  ]);
  const ignoradas = possible(src, [
    "filasIgnoradas","ignoradas","skipped","omitidas","omitidos"
  ]);
  const conError = possible(src, [
    "filasConError","errores","withErrors","failed","fallidas"
  ]);
  let total = possible(src, ["total","filas","totalFilas","rows","processed","leidas","leyadas","filasLeidas"]);
  if (!total) total = insertadas + actualizadas + ignoradas + conError;

  const filasLeidas = src?.filasLeidas ?? r?.filasLeidas ?? total ?? "N/D";

  return { insertadas, actualizadas, ignoradas, conError, total, filasLeidas };
};

// ===== NUEVO: parser del TXT que devuelve el backend (para llenar los cuadros)
const parseTemplateTxtSummary = (text) => {
  // Sección [RESUMEN] con pares k=v
  const counts = { insertadas:0, actualizadas:0, ignoradas:0, conError:0, total:0, filasLeidas:"N/D" };
  const lines = (text || "").split(/\r?\n/);
  let inResumen = false;
  for (const ln of lines) {
    const l = ln.trim();
    if (!l) continue;
    if (l.startsWith("[RESUMEN]")) { inResumen = true; continue; }
    if (inResumen && l.startsWith("----")) { inResumen = false; continue; }
    if (inResumen) {
      const m = /^([a-zA-Z_]+)\s*=\s*(.+)$/.exec(l);
      if (!m) continue;
      const key = m[1].toLowerCase();
      const val = m[2].trim();
      const num = Number(val);
      if (key === "filasleidas") counts.filasLeidas = isNaN(num) ? val : num;
      if (key === "insertados") counts.insertadas = isNaN(num) ? 0 : num;
      if (key === "actualizados") counts.actualizadas = isNaN(num) ? 0 : num;
      if (key === "omitidos") counts.ignoradas = isNaN(num) ? 0 : num;
      if (key === "errores") counts.conError = isNaN(num) ? 0 : num;
    }
  }
  counts.total = (counts.insertadas || 0) + (counts.actualizadas || 0) + (counts.ignoradas || 0) + (counts.conError || 0);
  return counts;
};

// Construye solo la sección de incidencias (compatibilidad con tu formato actual)
const buildTxtFromErrores = (errores) => {
  const lines = [TXT_HEADER];
  errores.forEach(({ codigo, motivo }) => {
    lines.push(`(el codigo : ${codigo}) - ${motivo || "Motivo no especificado"}`);
  });
  return lines.join("\n");
};

// ====== NUEVO: capturar mensajes de WARN/INCIDENCIAS del servidor ======
const parseWarningsFromHeaders = (headers) => {
  if (!headers) return [];
  const keys = ["X-Process-Warnings", "X-Warnings", "X-Server-Warn", "X-Error-Message"];
  const list = [];
  for (const k of keys) {
    const v = headers.get(k);
    if (v) {
      v.split(/\r?\n|\|\|/).forEach((line) => {
        const t = (line || "").trim();
        if (t) list.push(t);
      });
    }
  }
  return list;
};

const parseWarningsFromText = (text) => {
  if (!text) return [];
  const out = [];
  const lines = String(text).split(/\r?\n/);
  const re = /(WARN|ERROR)?.*?Fila\s+(\d+).*?(No se encontraron|no se encontraron|no encontrado|No encontrado|no existe|No existe).*?(c[oó]digo|codigo|c[oó]digo)\s*:?\s*([\w-]+)/i;
  for (const ln of lines) {
    const t = ln.trim();
    if (!t) continue;
    if (/Fila\s+\d+\s*:/.test(t) || /WARN/i.test(t)) {
      out.push(t);
      continue;
    }
    const m = re.exec(t);
    if (m) out.push(t);
  }
  return out;
};

const readBlobAsArrayBuffer = (blob) => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsArrayBuffer(blob);
  });
};

const parseWarningsFromExcelBlob = async (blob) => {
  try {
    const ab = await readBlobAsArrayBuffer(blob);
    const wb = XLSX.read(ab, { type: "array" });
    const warnings = [];
    wb.SheetNames.forEach((name) => {
      const ws = wb.Sheets[name];
      const range = XLSX.utils.decode_range(ws["!ref"] || "A1");
      for (let r = range.s.r; r <= range.e.r; r++) {
        for (let c = range.s.c; c <= range.e.c; c++) {
          const addr = XLSX.utils.encode_cell({ r, c });
          const cell = ws[addr];
          const v = cell?.v;
          if (!v || typeof v !== "string") continue;
          const t = v.trim();
          if (!t) continue;
          if (/Fila\s+\d+\s*:/.test(t) || /WARN/i.test(t) || /No se encontraron/i.test(t)) {
            warnings.push(t);
          }
        }
      }
    });
    return Array.from(new Set(warnings));
  } catch (e) {
    return [];
  }
};

const secondsFmt = (ms) => `${Math.max(0, Math.round(ms / 1000))}s`;

const buildDetailedLogFybeca = ({
  fileName,
  fileSizeBytes = 0,
  estMs = 0,
  elapsedMs = 0,
  counts = { insertadas:0, actualizadas:0, ignoradas:0, conError:0, total:0 },
  incidencias = [],
}) => {
  const sizeMB = (fileSizeBytes / (1024 * 1024)) || 0;
  const safe = (n) => (Number.isFinite(n) ? n : 0);
  const total = safe(counts.total);
  const elapsedSec = Math.max(1, Math.round(elapsedMs / 1000));
  const tps = total ? (total / elapsedSec).toFixed(2) : "0.00";
  const tpm = total ? (total * 60 / elapsedSec).toFixed(2) : "0.00";

  const lines = [
    "LOG_CARGA_DETALLADO_TEMPLATE",
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
  ];

  const inc = Array.isArray(incidencias) ? incidencias.filter(Boolean) : [];
  lines.push("");
  lines.push("INCIDENCIAS:");
  if (inc.length) {
    inc.forEach((t) => lines.push(`  ${t}`));
  } else {
    lines.push("  (sin incidencias)");
  }

  return lines.join("\n");
};

const buildIncidenciasTxt = ({ fileName, counts, errores, incidencias = [] }) => {
  const now = new Date();
  const dd = String(now.getDate()).padStart(2, "0");
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const yyyy = now.getFullYear();
  const HH = String(now.getHours()).padStart(2, "0");
  const MM = String(now.getMinutes()).padStart(2, "0");
  const SS = String(now.getSeconds()).padStart(2, "0");

  const safe = (n) => (Number.isFinite(n) ? n : 0);

  const lines = [
    "INCIDENCIAS_TEMPLATE_GENERAL",
    `FECHA_HORA: ${yyyy}-${mm}-${dd} ${HH}:${MM}:${SS}`,
    `ARCHIVO: ${fileName || "N/D"}`,
    "",
    "RESUMEN:",
    `  FILAS_LEIDAS: ${safe(counts.total)}`,
    `  FILAS_ACTUALIZADAS: ${safe(counts.actualizadas)}`,
    `  FILAS_IGNORADAS: ${safe(counts.ignoradas)}`,
    `  FILAS_CON_ERROR: ${safe(counts.conError)}`,
    "",
  ];

  if (errores?.length) {
    lines.push("CODIGOS_NO_ENCONTRADOS");
    errores.forEach(({ codigo, motivo }) => {
      lines.push(`(el codigo : ${codigo}) - ${motivo || "Motivo no especificado"}`);
    });
  } else {
    lines.push("SIN_INCIDENCIAS_DE_CODIGOS_NO_ENCONTRADOS");
  }

  lines.push("");
  lines.push("INCIDENCIAS_SERVIDOR:");
  if (incidencias?.length) {
    incidencias.forEach((t) => lines.push(`  ${t}`));
  } else {
    lines.push("  (sin incidencias)");
  }

  return lines.join("\n");
};

const saveTextFile = async (contenido, suggestedName = "log.txt") => {
  try {
    if (!window.showSaveFilePicker) {
      // Fallback: descarga directa, pero idealmente usar navegadores compatibles con File System Access API
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

const TemplateGeneral = () => {
  const toast = useRef(null);
  const fileInputRef = useRef(null);

  const [ventas, setVentas] = useState([]);
  const [loadingVentas, setLoadingVentas] = useState(false);
  const [loadingTemplate, setLoadingTemplate] = useState(false);
  const [editVenta, setEditVenta] = useState(null);
  const [selectedVentas, setSelectedVentas] = useState([]);

  const [marcas, setMarcas] = useState([]);
  const [yearsOptions, setYearsOptions] = useState([]);
  const [monthsOptions, setMonthsOptions] = useState([]);
  const [globalFilter, setGlobalFilter] = useState("");

  const [filterYear, setFilterYear] = useState(null);
  const [filterMonth, setFilterMonth] = useState(null);
  const [filterMarca, setFilterMarca] = useState("");
  const [filterDate, setFilterDate] = useState(null);

  const [appliedFilters, setAppliedFilters] = useState({
    year: null,
    month: null,
    marca: "",
    date: null,
  });

  const [paginatorState, setPaginatorState] = useState({ first: 0, rows: 10, page: 0 });

  const [uploadRemainingMs, setUploadRemainingMs] = useState(null);
  const [uploadElapsedMs, setUploadElapsedMs] = useState(0);
  const uploadTimerRef = useRef(null);
  const elapsedTimerRef = useRef(null);

  // === NUEVO: estados para guardar logs manualmente ===
  const [logIncidenciasTxt, setLogIncidenciasTxt] = useState(null);
  const [logIncidenciasName, setLogIncidenciasName] = useState(null);
  const [logDetalladoTxt, setLogDetalladoTxt] = useState(null);
  const [logDetalladoName, setLogDetalladoName] = useState(null);

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
    elapsedTimerRef.current = setInterval(() => {
      setUploadElapsedMs((ms) => ms + 1000);
    }, 1000);
    return () => {
      if (elapsedTimerRef.current) {
        clearInterval(elapsedTimerRef.current);
        elapsedTimerRef.current = null;
      }
    };
  }, [loadingTemplate]);

  const showToast = ({ type = "info", summary, detail, life = 3500 }) => {
    if (!toast.current) return;
    toast.current.show({ severity: type, summary, detail, life });
  };
  const showSuccess = (m) => showToast({ type: "success", summary: "Éxito", detail: m });
  const showInfo = (m) => showToast({ type: "info", summary: "Información", detail: m });
  const showWarn = (m) => showToast({ type: "warn", summary: "Advertencia", detail: m });
  const showError = (m) => showToast({ type: "error", summary: "Error", detail: m, life: 8000 });

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
      const years = [...new Set(ventas.map((v) => v.anio))]
        .filter(Number.isFinite)
        .sort((a, b) => a - b);
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
        ...new Set(ventas.filter((v) => v.anio === anio).map((v) => v.mes)),
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
      const { data } = await apiFetch("/venta");
      const list = Array.isArray(data) ? data : [];
      setVentas(list);
      setPaginatorState((p) => ({ ...p, first: 0, page: 0 }));
    } catch (e) {
      showError("Error al cargar ventas");
      setVentas([]);
      setPaginatorState((p) => ({ ...p, first: 0, page: 0 }));
    } finally {
      setLoadingVentas(false);
    }
  };

  const hasAnyApplied = useMemo(
    () =>
      appliedFilters.year !== null ||
      appliedFilters.month !== null ||
      !!appliedFilters.marca ||
      !!appliedFilters.date,
    [appliedFilters]
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
    return params.toString();
  };

  const filterLocalData = (data, f) => {
    return data.filter((item) => {
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
      setVentas(list);
      setPaginatorState((prev) => ({ ...prev, first: 0, page: 0 }));
      showSuccess(`Se encontraron ${list.length} registros con los filtros aplicados.`);
    } catch (e) {
      console.error(e);
      showWarn("No se pudo conectar a la API. Aplicando filtros localmente...");
      const filteredData = filterLocalData(ventas, f);
      setVentas(filteredData);
      setPaginatorState((prev) => ({ ...prev, first: 0, page: 0 }));
      showInfo(`Se encontraron ${filteredData.length} registros con los filtros aplicados localmente.`);
    } finally {
      setLoadingVentas(false);
    }
  };

  useEffect(() => {
    loadMarcas();
    loadYearsOptions();
    loadVentas();
  }, []);

  useEffect(() => {
    setPaginatorState((p) => ({ ...p, first: 0, page: 0 }));
  }, [appliedFilters, globalFilter]);

  const onPageChange = (e) => setPaginatorState(e);

  const filteredData = useMemo(() => {
    let base = [...ventas];
    if (hasAnyApplied && !base._fromApi) {
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
  }, [ventas, hasAnyApplied, appliedFilters, globalFilter]);

  const cargarTemplate = async (file) => {
    if (!file) return showWarn("No seleccionaste ningún archivo.");
    const ext = file.name.split(".").pop().toLowerCase();
    if (!["xlsx", "xls"].includes(ext)) return showError("Tipo de archivo no soportado. Sube un Excel (.xlsx o .xls).");

    setLoadingTemplate(true);
    setUploadElapsedMs(0);

    const controllerTimeoutMs = 30 * 60 * 1000;
    let erroresNormalizados = [];
    let counts = { insertadas:0, actualizadas:0, ignoradas:0, conError:0, total:0, filasLeidas: "N/D" };
    let incidenciasServidor = [];

    // limpiar logs previos
    setLogIncidenciasTxt(null);
    setLogIncidenciasName(null);
    setLogDetalladoTxt(null);
    setLogDetalladoName(null);

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

      const res = await fetch(`${API_BASE}/subir-archivo-template-general`, {
        method: "POST",
        body: formData,
        signal: AbortSignal.timeout(controllerTimeoutMs),
      });

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
      const suggestedFilename = getFilenameFromCD(cd) || "incidencias_template_general.txt";

      incidenciasServidor = parseWarningsFromHeaders(res.headers);

      if (contentType.includes("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")) {
        // El backend devolvió un Excel con incidencias u observaciones.
        const blob = await res.blob();
        // Descargamos directamente el Excel (no es TXT). El usuario puede elegir carpeta con el diálogo del navegador.
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = suggestedFilename.endsWith(".txt")
          ? suggestedFilename.replace(/\.txt$/i, ".xlsx")
          : suggestedFilename || "reporte_incidencias.xlsx";
        a.click();
        URL.revokeObjectURL(url);
        try {
          const extra = await parseWarningsFromExcelBlob(blob);
          incidenciasServidor = Array.from(new Set([...(incidenciasServidor || []), ...(extra || [])]));
        } catch {}
        showSuccess("Archivo procesado correctamente (Excel de incidencias descargado).");
      } else if (contentType.includes("application/json")) {
        const result = await res.json();
        erroresNormalizados = normalizeErrores(result);
        const cnt = extractCounts(result);
        counts = { ...counts, ...cnt };

        const warnFields = ["warnings", "mensajes", "logs", "serverLogs"];
        warnFields.forEach((k) => {
          const v = result?.[k];
          if (Array.isArray(v)) {
            v.forEach((t) => {
              const s = String(t || "").trim();
              if (s) incidenciasServidor.push(s);
            });
          } else if (typeof v === "string" && v.trim()) {
            incidenciasServidor.push(v.trim());
          }
        });
        incidenciasServidor = Array.from(new Set([...(incidenciasServidor || []), ...parseWarningsFromHeaders(res.headers)]));

        // Construimos texto de incidencias pero NO lo descargamos automáticamente.
        const now = new Date();
        const fechaStr = now.toISOString().replace(/[:T]/g, "-").split(".")[0];
        const incidenciasTxt = buildIncidenciasTxt({
          fileName: file.name,
          counts,
          errores: erroresNormalizados,
          incidencias: incidenciasServidor,
        });
        setLogIncidenciasTxt(incidenciasTxt);
        setLogIncidenciasName(`incidencias_template_general_${fechaStr}.txt`);

        showSuccess("Archivo procesado correctamente. Usa 'Guardar Incidencias' para elegir dónde guardar el TXT.");
      } else if (contentType.includes("text/plain")) {
        // El backend retornó TXT crudo -> lo guardamos en estado para guardado manual
        const text = await res.text();
        const cnt = parseTemplateTxtSummary(text);
        counts = { ...counts, ...cnt };
        incidenciasServidor = Array.from(new Set([...(incidenciasServidor || []), ...parseWarningsFromText(text)]));
        setLogIncidenciasTxt(text);
        setLogIncidenciasName(suggestedFilename || "incidencias_template_general.txt");
        showSuccess("Archivo procesado. Usa 'Guardar Incidencias' para elegir dónde guardar el TXT.");
      } else {
        const text = await res.text();
        incidenciasServidor = Array.from(new Set([...(incidenciasServidor || []), ...parseWarningsFromText(text)]));
        showInfo(text?.substring(0, 200) || "Procesado.");
      }

      // Fin de la llamada; recargamos ventas según filtros
      await (hasAnyApplied ? fetchVentasWithFilters(appliedFilters) : loadVentas());

      // Construir log detallado y dejarlo listo para guardar manualmente
      const end = performance.now();
      const elapsedMs = Math.max(0, Math.round(end - start));

      const detailedLogFybeca = buildDetailedLogFybeca({
        fileName: file.name,
        fileSizeBytes: file.size,
        estMs,
        elapsedMs,
        counts,
        incidencias: incidenciasServidor,
      });
      setLogDetalladoTxt(detailedLogFybeca);
      const now2 = new Date();
      const fechaStr2 = now2.toISOString().replace(/[:T]/g, "-").split(".")[0];
      setLogDetalladoName(`log_detallado_template_general_${fechaStr2}.txt`);

      // TOAST con info + instrucción para guardar manualmente
      toast.current?.show({
        severity: (counts.conError || incidenciasServidor.length) ? "warn" : "success",
        summary: "Carga finalizada",
        detail: (
          <div className="flex flex-column gap-2" style={{ lineHeight: 1.4 }}>
            <div><b>Listo:</b> ahora puedes guardar los archivos desde los botones <b>Guardar Incidencias</b> y <b>Guardar Log detallado</b> en la barra.</div>
            {incidenciasServidor?.length > 0 && (
              <div style={{ marginTop: "0.5rem" }}>
                <div className="font-bold">Incidencias reportadas por el servidor:</div>
                <ul style={{ margin: 0, paddingLeft: "1.25rem" }}>
                  {incidenciasServidor.slice(0, 5).map((t, i) => <li key={i} style={{ whiteSpace: "pre-wrap" }}>{t}</li>)}
                  {incidenciasServidor.length > 5 && <li>... ({incidenciasServidor.length - 5} más)</li>}
                </ul>
              </div>
            )}
          </div>
        ),
        sticky: true,
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

  const actualizarVenta = async (venta) => {
    try {
      await apiFetch(`/venta/${venta.id}`, {
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
    if (selectedVentas.length > MAX_DELETE) {
      showWarn(`Selecciona como máximo ${MAX_DELETE.toLocaleString()} registros por eliminación.`);
      return;
    }

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
          const ids = selectedVentas.map((v) => v.id);
          const chunkSize = 2000;
          for (let i = 0; i < ids.length; i += chunkSize) {
            const slice = ids.slice(i, i + chunkSize);
            await apiFetch("/ventas-forma-masiva", {
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

  const downloadVentasReport = async () => {
    setLoadingVentas(true);
    try {
      const { blob, filename } = await apiFetch("/reporte-ventas", { expect: "blob" });
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = filename || "reporte_ventas_template_general.xlsx";
      link.click();
      showSuccess("Reporte de ventas descargado correctamente");
    } catch (e) {
      showError(String(e));
    } finally {
      setLoadingVentas(false);
    }
  };

  const downloadFilteredVentasReport = () => {
    const dataTable = filteredData.length ? filteredData : ventas;
    if (!dataTable.length) {
      showWarn("No hay datos para generar el reporte.");
      return;
    }
    const exportData = dataTable.map((v) => ({
      "Año": v.anio,
      "Mes": monthLabel(v.mes),
      "Día": v.dia,
      "Marca": v.marca,
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
    const numCols = ["J", "K", "L", "M"];
    for (let i = 2; i <= exportData.length + 1; i++) {
      numCols.forEach((col) => {
        const cell = ws[`${col}${i}`];
        if (cell) cell.z = "#,##0.00";
      });
    }

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Ventas Filtradas");

    const today = new Date();
    const dateStr = `${today.getDate()}-${today.getMonth() + 1}-${today.getFullYear()}`;
    let fileName = "Reporte_Ventas_TemplateGeneral_";
    if (Number.isFinite(appliedFilters.year)) fileName += `${appliedFilters.year}_`;
    if (Number.isFinite(appliedFilters.month)) fileName += `${monthLabel(appliedFilters.month)}_`;
    if (appliedFilters.marca) fileName += `${appliedFilters.marca}_`;
    fileName += dateStr + ".xlsx";

    XLSX.writeFile(wb, fileName);
    showSuccess(`Se ha generado el reporte con ${exportData.length} registros.`);
  };

  const handleApplyFilters = async () => {
    if (filterMonth !== null && filterYear === null) {
      showWarn("Para filtrar por Mes, selecciona primero un Año.");
      return;
    }
    const newApplied = { year: filterYear, month: filterMonth, marca: filterMarca, date: filterDate };
    setAppliedFilters(newApplied);
    setGlobalFilter("");
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
    await loadVentas();
    showInfo("Filtros limpiados correctamente.");
  };

  const onSelectionChange = (e) => {
    const next = Array.isArray(e.value) ? e.value : [];
    if (next.length > MAX_DELETE) {
      const trimmed = next.slice(0, MAX_DELETE);
      setSelectedVentas(trimmed);
      showWarn(`Solo puedes seleccionar hasta ${MAX_DELETE.toLocaleString()} registros para eliminar.`);
    } else {
      setSelectedVentas(next);
    }
  };

  // Handlers de guardado manual de logs
  const handleSaveIncidencias = async () => {
    if (!logIncidenciasTxt) {
      showWarn("No hay incidencias generadas todavía.");
      return;
    }
    try {
      const ok = await saveTextFile(logIncidenciasTxt, logIncidenciasName || "incidencias_template_general.txt");
      if (ok) showSuccess("Incidencias guardadas.");
    } catch (e) {
      showError("No se pudo guardar el archivo de incidencias.");
    }
  };

  const handleSaveLogDetallado = async () => {
    if (!logDetalladoTxt) {
      showWarn("No hay log detallado generado todavía.");
      return;
    }
    try {
      const ok = await saveTextFile(logDetalladoTxt, logDetalladoName || "log_detallado_template_general.txt");
      if (ok) showSuccess("Log detallado guardado.");
    } catch (e) {
      showError("No se pudo guardar el log detallado.");
    }
  };

  return (
    <div className="fybeca-container">
      <Toast ref={toast} position="top-right" />
      <ConfirmDialog />

      <div className="grid">
        <div className="col-12">
          <div className="card">
            <h1 className="text-center mb-4">Template General — Ventas</h1>

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
                        cargarTemplate(e.target.files[0]);
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
                    onClick={() => (window.location.href = "/TEMPLATE PLANTILLA FIJA.xlsx")}
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
                  {/* NUEVOS BOTONES: guardado manual */}
                  <Button
                    label="Guardar Incidencias"
                    icon="pi pi-save"
                    className="p-button-warning"
                    onClick={handleSaveIncidencias}
                    disabled={!logIncidenciasTxt}
                    tooltip={logIncidenciasName || "incidencias_template_general.txt"}
                    tooltipOptions={{ position: "bottom" }}
                  />
                  <Button
                    label="Guardar Log detallado"
                    icon="pi pi-save"
                    className="p-button-secondary"
                    onClick={handleSaveLogDetallado}
                    disabled={!logDetalladoTxt}
                    tooltip={logDetalladoName || "log_detallado_template_general.txt"}
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

            <DataTable
              value={filteredData}
              loading={loadingVentas}
              paginator
              rows={paginatorState.rows}
              rowsPerPageOptions={[5, 10, 25, 50]}
              first={paginatorState.first}
              onPage={onPageChange}
              paginatorClassName="p-3 deprati-square-paginator"
              paginatorTemplate="FirstPageLink PrevPageLink PageLinks NextPageLink LastPageLink RowsPerPageDropdown CurrentPageReport"
              currentPageReportTemplate={`Mostrando {first} a {last} de ${filteredData.length} registros`}
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
              <Column field="ventaUnidad" header="Venta Unidades" sortable body={(r) => Number(r.ventaUnidad ?? 0)} />
              <Column field="ventaDolares" header="Venta $" sortable body={(r) => (Number(r.ventaDolares ?? 0)).toFixed(2)} />
              <Column field="stockUnidades" header="Stock Unidades" sortable body={(r) => Number(r.stockUnidades ?? 0)} />
              <Column field="stockDolares" header="Stock $" sortable body={(r) => (Number(r.stockDolares ?? 0)).toFixed(2)} />
              <Column
                header="Acciones"
                body={(rowData) => (
                  <div className="flex gap-2 justify-content-center">
                    <Button
                      icon="pi pi-pencil"
                      className="p-button-rounded p-button-success p-button-outlined"
                      onClick={() => setEditVenta(rowData)}
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

export default TemplateGeneral;
