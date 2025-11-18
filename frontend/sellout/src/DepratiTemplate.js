
import React, { useEffect, useState, useRef, useMemo } from "react";
import "./css/deprati.css";
import "primereact/resources/themes/lara-light-indigo/theme.css";
import "primereact/resources/primereact.min.css";
import "primeicons/primeicons.css";
import "primeflex/primeflex.css";
import 'primeicons/primeicons.css';

import * as XLSX from "xlsx";
import { Toast } from "primereact/toast";
import { ProgressSpinner } from "primereact/progressspinner";
import { Calendar } from "primereact/calendar";
import { DataTable } from 'primereact/datatable';
import { Column } from 'primereact/column';
import { InputSwitch } from 'primereact/inputswitch';
import { Button } from 'primereact/button';
import { Dialog } from 'primereact/dialog';
import { InputText } from 'primereact/inputtext';
import { InputNumber } from 'primereact/inputnumber';
import { Dropdown } from 'primereact/dropdown';
import { Card } from 'primereact/card';
import { Toolbar } from 'primereact/toolbar';
import { Divider } from 'primereact/divider';
import { ConfirmDialog, confirmDialog } from 'primereact/confirmdialog';

const Deprati = () => {
  const [isSaving, setIsSaving] = useState(false);

  // Estados núcleo
  const [ventas, setVentas] = useState([]);
  const [filteredVentas, setFilteredVentas] = useState([]);  // vacío hasta que apliques un filtro
  const [loadingVentas, setLoadingVentas] = useState(false);
  const [selectedVentas, setSelectedVentas] = useState([]);
  const [editVenta, setEditVenta] = useState(null);
  const toast = useRef(null);

  // Carga/overlay/tiempos
  const [loadingTemplate, setLoadingTemplate] = useState(false);
  const [etaMs, setEtaMs] = useState(0);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [countdownText, setCountdownText] = useState("");
  const [timerId, setTimerId] = useState(null);
  const [t0, setT0] = useState(0);

  // Diálogo de mapeo
  const [mapeoExcelDialogVisible, setMapeoExcelDialogVisible] = useState(false);
  const [selectedFile, setSelectedFile] = useState(null);

  // Tabla/selección
  const [rowClick, setRowClick] = useState(true);

  // Mapeo dinámico (usuario completará)
  const [mapeoExcel, setMapeoExcel] = useState({
    filaCodPdv: null,
    colCodPdv: null,
    filaPdv: null,
    colPdv: null,
    filaInicioDatos: null,
    colFecha: null,
    colMarca: null,
    colNombreProducto: null,
    colCodBarra: null,
    colInicioPDV: null,
    colFinPDV: null,
  });

  // Filtros
  const [filterYear, setFilterYear] = useState("");
  const [filterMonth, setFilterMonth] = useState("");
  const [filterMarca, setFilterMarca] = useState("");
  const [filterDate, setFilterDate] = useState(null);
  const [marcas, setMarcas] = useState([]);
  const [globalFilter, setGlobalFilter] = useState('');

  // Paginación
  const [paginatorState, setPaginatorState] = useState({
    first: 0,
    rows: 10,
    page: 0,
    totalRecords: 0
  });

  useEffect(() => {
    loadMarcas();
    loadVentas();
  }, []);

  useEffect(() => {
    setPaginatorState(prev => ({
      ...prev,
      totalRecords: filteredVentas.length,
      first: 0,
      page: 0
    }));
  }, [filteredVentas]);

  const onPageChange = (event) => setPaginatorState(event);

  // Años/meses
  const years = useMemo(() => [...new Set(ventas.map(v => v.anio))].sort(), [ventas]);
  const months = [
    { label: 'Enero', value: 1 },
    { label: 'Febrero', value: 2 },
    { label: 'Marzo', value: 3 },
    { label: 'Abril', value: 4 },
    { label: 'Mayo', value: 5 },
    { label: 'Junio', value: 6 },
    { label: 'Julio', value: 7 },
    { label: 'Agosto', value: 8 },
    { label: 'Septiembre', value: 9 },
    { label: 'Octubre', value: 10 },
    { label: 'Noviembre', value: 11 },
    { label: 'Diciembre', value: 12 }
  ];

  // ==== Utilidades de Toast ====
  const showSuccess = (detail) => toast.current?.show({ severity: "success", summary: "Éxito", detail, life: 4000, className: "deprati-toast deprati-toast-success" });
  const showInfo    = (detail) => toast.current?.show({ severity: "info",    summary: "Información", detail, life: 4000, className: "deprati-toast deprati-toast-info" });
  const showWarn    = (detail) => toast.current?.show({ severity: "warn",    summary: "Advertencia", detail, life: 6000, className: "deprati-toast deprati-toast-warning" });
  const showError   = (detail) => toast.current?.show({ severity: "error",   summary: "Error", detail, life: 6000, className: "deprati-toast deprati-toast-error" });

  // ==== Carga de datos ====
  const loadMarcas = async () => {
    try {
      const res = await fetch("/api-sellout/fybeca/marcas-ventas");
      if (!res.ok) throw new Error("Error al cargar marcas");
      const data = await res.json();
      setMarcas(Array.isArray(data) ? data : []);
    } catch (e) { console.error(e); }
  };

  const loadVentas = async () => {
    setLoadingVentas(true);
    try {
      const res = await fetch("/api-sellout/deprati/venta");
      if (!res.ok) throw new Error("Error al cargar ventas");
      const data = await res.json();
      const processed = (Array.isArray(data) ? data : []).map(v => (v?.cliente?.ciudad ? { ...v, ciudad: v.cliente.ciudad } : v));
      setVentas(processed);
      // No mostramos datos hasta aplicar un filtro
    } catch (e) {
      console.error(e);
      showError("Error al cargar ventas");
    } finally {
      setLoadingVentas(false);
    }
  };

  // ==== Normalización errores del backend ====
  const normalizeErrores = (result) => {
    const toPair = (x, defaultMotivo = "Motivo no especificado") => (typeof x === "object"
      ? { codigo: x.codigo ?? x.cod ?? x.code ?? x.id ?? "N/D", motivo: x.motivo ?? x.error ?? x.mensaje ?? defaultMotivo }
      : { codigo: String(x), motivo: defaultMotivo });

    if (Array.isArray(result?.codigosNoEncontrados)) return result.codigosNoEncontrados.map(x => toPair(x, "No se pudo mapear el código"));
    if (Array.isArray(result?.errores)) return result.errores.map(toPair);
    if (Array.isArray(result?.itemsFallidos)) return result.itemsFallidos.map(toPair);
    if (Array.isArray(result)) return result.map(toPair);
    if (Array.isArray(result?.lista)) return result.lista.map(c => ({ codigo: String(c), motivo: result?.motivo ?? "Motivo no especificado" }));
    return [];
  };

  // Posibles códigos exitosos si el backend los enviara
  const normalizeExitos = (result) => {
    const arr = result?.codigosExitosos ?? result?.exitos ?? result?.itemsProcesados ?? [];
    if (!Array.isArray(arr)) return [];
    return arr.map(x => (typeof x === "object" ? (x.codigo ?? x.cod ?? x.code ?? x.id ?? "N/D") : String(x)));
  };

  // ==== TXT de incidencias (siempre) ====
  const buildIncidentTxt = ({ fileName, fileSizeBytes, startedAt, finishedAt, etaMsUsed, elapsedMsReal, filasLeidas, filasProcesadas, cantExitos, cantErrores, cantNoEncontrados }, errores, exitosos) => {
    const fmt2 = (n) => n.toString().padStart(2, "0");
    const fmtHMS = (ms) => {
      const s = Math.floor(ms / 1000);
      const hh = Math.floor(s / 3600);
      const mm = Math.floor((s % 3600) / 60);
      const ss = s % 60;
      return `${fmt2(hh)}:${fmt2(mm)}:${fmt2(ss)} (${ms} ms)`;
    };
    const bytesToMB = (b) => (b / (1024 * 1024)).toFixed(2);

    const d = new Date(startedAt);
    const f = new Date(finishedAt);
    const fecha = d.toLocaleDateString("es-EC");
    const horaInicio = d.toLocaleTimeString("es-EC");
    const horaFin = f.toLocaleTimeString("es-EC");

    const lines = [];
    lines.push("==== INCIDENCIAS DE CARGA — VENTAS DEPRATI ====");
    lines.push(`Fecha: ${fecha}`);
    lines.push(`Hora inicio: ${horaInicio}`);
    lines.push(`Hora fin: ${horaFin}`);
    lines.push(`Archivo: ${fileName}`);
    lines.push(`Tamaño: ${bytesToMB(fileSizeBytes)} MB (${fileSizeBytes} bytes)`);
    lines.push(`ETA (estimado): ${fmtHMS(etaMsUsed)}`);
    lines.push(`Tiempo real: ${fmtHMS(elapsedMsReal)}`);
    lines.push(`Filas leídas: ${filasLeidas ?? "N/D"}`);
    lines.push(`Filas procesadas: ${filasProcesadas ?? "N/D"}`);
    lines.push(`Códigos exitosos: ${cantExitos}`);
    lines.push(`Errores: ${cantErrores}`);
    lines.push(`Códigos no encontrados: ${cantNoEncontrados}`);
    lines.push("");
    if ((errores?.length ?? 0) === 0 && (exitosos?.length ?? 0) === 0) {
      lines.push("SIN DETALLE DE CÓDIGOS. El backend no devolvió listas de éxito o error.");
    }
    if (exitosos?.length) {
      lines.push("---- DETALLE CÓDIGOS EXITOSOS ----");
      exitosos.forEach(c => lines.push(`OK: ${c}`));
      lines.push("");
    }
    if (errores?.length) {
      lines.push("---- DETALLE ERRORES / NO ENCONTRADOS ----");
      errores.forEach(({ codigo, motivo }) => lines.push(`(el codigo : ${codigo}) - ${motivo || 'Motivo no especificado'}`));
      lines.push("");
    }
    lines.push("==============================================");
    return lines.join("\n");
  };

  const saveTxt = async (filenameSuggested, content) => {
    try {
      if (window.showSaveFilePicker) {
        const handle = await window.showSaveFilePicker({
          suggestedName: filenameSuggested,
          types: [{ description: "Archivo de texto", accept: { "text/plain": [".txt"] } }]
        });
        const writable = await handle.createWritable();
        await writable.write(content);
        await writable.close();
      } else {
        const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
        const link = document.createElement("a");
        link.href = URL.createObjectURL(blob);
        link.download = filenameSuggested;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
      }
      showSuccess("TXT de incidencias guardado correctamente.");
    } catch (err) {
      if (err?.name !== "AbortError") {
        console.error("No se pudo guardar el TXT:", err);
        showError("No se pudo guardar el TXT.");
      }
    }
  };

  const promptSaveIncidencias = async (metrics, errores, exitosos) => {
    const fechaStr = new Date(metrics.finishedAt).toISOString().replace(/[:T]/g, "-").split(".")[0];
    const contenido = buildIncidentTxt(metrics, errores, exitosos);
    const fileName = `incidencias_deprati_${fechaStr}.txt`;
    await saveTxt(fileName, contenido);
  };

  // ==== ETA & cronómetro ====
  const calculateUploadTime = (fileSize) => {
    const mb = fileSize / (1024 * 1024);
    const uploadSpeedMBps = 0.5; // conservador
    const baseProcessingTime = 10000; // 10s
    const processingTimePerMB = 1000; // 1s/MB
    const uploadTimeMs = (mb / uploadSpeedMBps) * 1000;
    const processingTimeMs = baseProcessingTime + (mb * processingTimePerMB);
    const total = (uploadTimeMs + processingTimeMs) * 1.5;
    return Math.min(Math.max(total, 15000), 900000); // 15s..15min
  };

  const startTimer = (eta) => {
    if (timerId) clearInterval(timerId);
    const t0Now = performance.now();
    setT0(t0Now);
    setElapsedMs(0);
    setEtaMs(eta);

    const id = setInterval(() => {
      const now = performance.now();
      const elapsed = now - t0Now;
      setElapsedMs(elapsed);
      const remaining = Math.max(eta - elapsed, 0);
      const mins = Math.floor(remaining / 60000);
      const secs = Math.floor((remaining % 60000) / 1000);
      setCountdownText(`${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`);

      // Si supera la ETA en 20%, avisar que tardará más
      if (elapsed > eta * 1.2 && elapsed < eta * 1.21) {
        showInfo("Parece que la carga tardará más de lo estimado. Aún procesando…");
      }
    }, 250);
    setTimerId(id);
  };

  const stopTimer = () => {
    if (timerId) clearInterval(timerId);
    setTimerId(null);
  };

  // ==== Carga/POST ====
  const handleUpload = (file) => {
    if (!file?.name?.match(/\.(xlsx|xls)$/i)) {
      showError("El archivo debe ser Excel (.xlsx o .xls).");
      return;
    }
    if (file.size > 10000000) {
      showError("El archivo es demasiado grande. Máximo 10MB.");
      return;
    }
    setSelectedFile(file);
    setMapeoExcelDialogVisible(true);
  };

  const appendNumberParam = (fd, key, value) => {
    if (value !== undefined && value !== null && value !== "") {
      const num = parseInt(value);
      if (!isNaN(num)) fd.append(key, num);
    }
  };

  const handleUploadWithMapeo = async (file) => {
    setLoadingTemplate(true);

    const formData = new FormData();
    formData.append("file", file);
    appendNumberParam(formData, "filaCodPdv", mapeoExcel.filaCodPdv);
    appendNumberParam(formData, "columnaCodPdv", mapeoExcel.colCodPdv);
    appendNumberParam(formData, "filaPdv", mapeoExcel.filaPdv);
    appendNumberParam(formData, "columnaPdv", mapeoExcel.colPdv);
    appendNumberParam(formData, "filaInicioDatos", mapeoExcel.filaInicioDatos);
    appendNumberParam(formData, "columnaFecha", mapeoExcel.colFecha);
    appendNumberParam(formData, "columnaMarca", mapeoExcel.colMarca);
    appendNumberParam(formData, "columnaNombreProducto", mapeoExcel.colNombreProducto);
    appendNumberParam(formData, "columnaCodBarra", mapeoExcel.colCodBarra);
    appendNumberParam(formData, "columnaInicioPDV", mapeoExcel.colInicioPDV);
    appendNumberParam(formData, "columnaFinPDV", mapeoExcel.colFinPDV);

    // ETA y cronómetro
    const eta = calculateUploadTime(file.size);
    startTimer(eta);

    const minutes = Math.floor(eta / 60000);
    const seconds = Math.floor((eta % 60000) / 1000);
    const timeMessage = minutes > 0 ? `~ ${minutes}m ${seconds}s` : `~ ${seconds}s`;

    const toastId = toast.current?.show({
      severity: "info",
      summary: "Cargando archivo",
      detail: `Subiendo ${file.name}. DEPRATI: ${timeMessage}. No cierre esta ventana.`,
      life: 0,
      sticky: true,
      className: "deprati-toast deprati-toast-info deprati-toast-persistent"
    });

    // Marca de inicio (precisa)
    const perfStart = performance.now();
    const wallStart = Date.now();

    try {
      const response = await fetch("/api-sellout/deprati/subir-archivos-motor-maping", {
        method: "POST",
        body: formData,
        signal: AbortSignal.timeout(1800000) // 30min
      });

      if (!response.ok) {
        const text = await response.text().catch(() => "");
        toast.current?.clear(toastId);
        throw new Error(text || `Error ${response.status}: ${response.statusText}`);
      }

      const result = await response.json().catch(() => ({}));

      // Marca de fin
      const perfEnd = performance.now();
      const wallEnd = Date.now();
      stopTimer();
      setLoadingTemplate(false);
      toast.current?.clear(toastId);
      showSuccess("Archivo cargado exitosamente.");

      const errores = normalizeErrores(result);
      const exitos = normalizeExitos(result);

      // Métricas (intenta leer del backend si existen)
      const filasLeidas = result?.filasLeidas ?? result?.rowsRead ?? result?.totalLeidas ?? null;
      const filasProcesadas = result?.filasProcesadas ?? result?.rowsProcessed ?? result?.procesadas ?? null;
      const cantNoEncontrados = errores.length;
      const cantExitos = exitos.length || (typeof result?.exitosos === "number" ? result.exitosos : (typeof result?.insertados === "number" ? result.insertados : 0));
      const cantErrores = (typeof result?.erroresCount === "number" ? result.erroresCount : 0) + cantNoEncontrados;

      const metrics = {
        fileName: file.name,
        fileSizeBytes: file.size,
        startedAt: wallStart,
        finishedAt: wallEnd,
        etaMsUsed: eta,
        elapsedMsReal: Math.round(perfEnd - perfStart),
        filasLeidas,
        filasProcesadas,
        cantExitos,
        cantErrores,
        cantNoEncontrados
      };

      // Mostrar opción de guardar TXT SIEMPRE
      toast.current?.show({
        severity: cantNoEncontrados > 0 ? "warn" : "info",
        sticky: true,
        className: "deprati-toast deprati-toast-info",
        content: (
          <div className="flex flex-column gap-2">
            <div className="font-bold">{cantNoEncontrados > 0 ? "Códigos no encontrados detectados" : "Carga finalizada"}</div>
            <div>
              Tiempo real: <b>{(metrics.elapsedMsReal/1000).toFixed(1)}s</b> — DEPRATI: <b>{(metrics.etaMsUsed/1000).toFixed(1)}s</b><br/>
              Leídas: <b>{filasLeidas ?? "N/D"}</b> | Procesadas: <b>{filasProcesadas ?? "N/D"}</b><br/>
              Éxitos: <b>{cantExitos}</b> | Errores: <b>{cantErrores}</b> | No encontrados: <b>{cantNoEncontrados}</b>
            </div>
            <div className="flex gap-2">
              <Button
                label="Guardar TXT de incidencias"
                icon="pi pi-save"
                className="p-button-sm p-button-warning"
                onClick={() => promptSaveIncidencias(metrics, errores, exitos)}
              />
              {cantNoEncontrados > 0 && (
                <Button
                  label="Guardar sólo NO ENCONTRADOS"
                  icon="pi pi-file"
                  className="p-button-sm p-button-help"
                  onClick={() => {
                    const header = "CODIGOS_NO_ENCOENTRADOS";
                    const body = errores.map(({codigo, motivo}) => `(el codigo : ${codigo}) - ${motivo || "Motivo no especificado"}`).join("\n");
                    const contenido = [header, body].join("\n");
                    const fechaStr = new Date(metrics.finishedAt).toISOString().replace(/[:T]/g, "-").split(".")[0];
                    saveTxt(`codigos_no_encontrados_${fechaStr}.txt`, contenido);
                  }}
                />
              )}
            </div>
          </div>
        )
      });

      await loadVentas();

    } catch (err) {
      stopTimer();
      setLoadingTemplate(false);
      toast.current?.clear();
      console.error("Error en la carga:", err);
      if (err?.name === "AbortError") {
        showError("Tiempo de carga excedido (timeout). Es posible que el servidor siga procesando.");
      } else if ((err?.message || "").includes("Failed to fetch")) {
        showError("No se pudo conectar con el servidor. Verifique su conexión.");
      } else {
        showError(err?.message || "Error inesperado al subir archivo.");
      }
    }
  };

  // ==== Filtros ====
  const handleApplyFilters = () => {
    const filtered = ventas.filter(v => (
      (filterYear ? parseInt(filterYear) === v.anio : true) &&
      (filterMonth ? parseInt(filterMonth) === v.mes : true) &&
      (filterMarca ? (v.marca && v.marca.toLowerCase() === filterMarca.toLowerCase()) : true) &&
      (filterDate ? (new Date(v.anio, v.mes - 1, v.dia).toDateString() === new Date(filterDate).toDateString()) : true)
    ));
    setFilteredVentas(filtered);
    if (filterYear || filterMonth || filterMarca || filterDate) {
      showInfo(`Se encontraron ${filtered.length} registros con los filtros aplicados`);
    }
  };

  const handleClearFilters = () => {
    setFilterYear("");
    setFilterMonth("");
    setFilterMarca("");
    setFilterDate(null);
    setFilteredVentas([]);  // permanece vacío hasta filtrar
    setGlobalFilter('');
  };

  // ==== Eliminar ====
  const executeDeleteSelected = async () => {
    const ids = selectedVentas.map(v => v.id);
    try {
      const res = await fetch("/api-sellout/deprati/ventas-forma-masiva", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(ids)
      });
      if (!res.ok) throw new Error("Error al eliminar las ventas");
      showSuccess("Ventas eliminadas exitosamente");
      setSelectedVentas([]);
      await loadVentas();
      handleApplyFilters();
    } catch (e) {
      console.error(e);
      showError(e.message || "Error al eliminar ventas");
    }
  };

  const handleDeleteSelected = () => {
    if (!selectedVentas.length) return;
    confirmDialog({
      message: `¿Está seguro de eliminar ${selectedVentas.length} venta(s)?`,
      header: 'Confirmación de eliminación',
      icon: 'pi pi-exclamation-triangle',
      acceptLabel: 'Sí, eliminar',
      rejectLabel: 'No, cancelar',
      acceptClassName: 'p-button-danger deprati-confirm-button',
      rejectClassName: 'p-button-secondary deprati-cancel-button',
      className: 'deprati-confirm-dialog',
      closable: false,
      accept: executeDeleteSelected
    });
  };

  const handleDelete = (id) => {
    confirmDialog({
      message: '¿Está seguro de eliminar esta venta?',
      header: 'Confirmación de eliminación',
      icon: 'pi pi-exclamation-triangle',
      acceptLabel: 'Sí, eliminar',
      rejectLabel: 'No, cancelar',
      acceptClassName: 'p-button-danger deprati-confirm-button',
      rejectClassName: 'p-button-secondary deprati-cancel-button',
      className: 'deprati-confirm-dialog',
      closable: false,
      accept: async () => {
        try {
          const res = await fetch(`/api-sellout/deprati/venta/${id}`, { method: "DELETE" });
          if (!res.ok) throw new Error("Error al eliminar la venta");
          showInfo("Venta eliminada exitosamente");
          loadVentas();
        } catch (e) {
          console.error(e);
          showError(e.message || "Error al eliminar la venta");
        }
      }
    });
  };

  // ==== Exportaciones ====
  const downloadFilteredReport = () => {
    if (!filteredVentas.length) {
      showWarn("No hay datos filtrados para generar el reporte.");
      return;
    }
    const ws = XLSX.utils.json_to_sheet(filteredVentas.map(item => ({
      'Año': item.anio,
      'Mes': item.mes,
      'Día': item.dia,
      'Marca': item.marca,
      'Código PDV': item.codPdv,
      'PDV': item.pdv,
      'Ciudad': item.ciudad,
      'Producto': item.nombreProducto,
      'Código Barra': item.codBarra,
      'Stock ($)': item.stockDolares,
      'Stock (U)': item.stockUnidades,
      'Venta ($)': item.ventaDolares,
      'Venta (U)': item.ventaUnidad
    })));
    const numberColumns = ['J','K','L','M'];
    for (let i = 2; i <= filteredVentas.length + 1; i++) {
      numberColumns.forEach(col => {
        const cell = ws[`${col}${i}`];
        if (cell) cell.z = '#,##0.00';
      });
    }
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Reporte Filtrado");
    const today = new Date();
    const dateStr = `${today.getDate()}-${today.getMonth()+1}-${today.getFullYear()}`;
    XLSX.writeFile(wb, `Reporte_Filtrado_Deprati_${dateStr}.xlsx`);
    showSuccess(`Se ha generado el reporte con ${filteredVentas.length} registros.`);
  };

  const exportToExcel = () => {
    if (!filteredVentas.length) {
      showWarn("No hay datos para exportar.");
      return;
    }
    const exportData = filteredVentas.map(item => ({
      'Año': item.anio, 'Mes': item.mes, 'Día': item.dia, 'Marca': item.marca,
      'Código PDV': item.codPdv, 'PDV': item.pdv, 'Ciudad': item.ciudad,
      'Producto': item.nombreProducto, 'Código Barra': item.codBarra,
      'Stock ($)': item.stockDolares, 'Stock (U)': item.stockUnidades,
      'Venta ($)': item.ventaDolares, 'Venta (U)': item.ventaUnidad
    }));
    const ws = XLSX.utils.json_to_sheet(exportData);
    const numberColumns = ['J','K','L','M'];
    for (let i = 2; i <= exportData.length + 1; i++) {
      numberColumns.forEach(col => {
        const ref = `${col}${i}`;
        if (ws[ref]) ws[ref].z = "#,##0.00";
      });
    }
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Ventas Deprati");
    XLSX.writeFile(wb, "Reporte_Ventas_Deprati.xlsx");
    showSuccess(`Se exportaron ${filteredVentas.length} registros a Excel`);
  };

  // ==== UI templates ====
  const leftToolbarTemplate = () => (
    <div className="deprati-toolbar-left flex flex-wrap align-items-center gap-3">
      <Button
        label="Importar Excel"
        icon="pi pi-file-excel"
        className="p-button-primary p-button-raised deprati-button deprati-import-excel-button"
        onClick={() => document.getElementById('fileUploadInput')?.click()}
      />
      <input
        id="fileUploadInput"
        type="file"
        accept=".xlsx,.xls"
        style={{ display: 'none' }}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) handleUpload(f);
          e.target.value = '';
        }}
      />
    </div>
  );

  const rightToolbarTemplate = () => (
    <div className="deprati-toolbar-right flex flex-wrap align-items-center justify-content-end gap-3">
      <Button
        label="Descargar Template"
        icon="pi pi-download"
        className="p-button-raised p-button-warning deprati-button deprati-button-warning"
        onClick={() => {
          const link = document.createElement('a');
          link.href = '/TEMPLATE_DEPRATI.xlsx';
          link.download = 'TEMPLATE VENTAS DEPRATI.xlsx';
          link.click();
        }}
      />
      <Button
        label="Exportar Excel"
        icon="pi pi-file-excel"
        className="p-button-success p-button-raised deprati-button deprati-button-export"
        onClick={exportToExcel}
      />
      <Button
        label="Reporte de Ventas Con Filtro"
        icon="pi pi-file-excel"
        onClick={downloadFilteredReport}
        className="p-button-success p-button-raised deprati-button"
        disabled={!filteredVentas.length}
      />
      <Button
        label="Eliminar Seleccionados"
        icon="pi pi-trash"
        className="deprati-button deprati-delete-selected-button"
        disabled={!selectedVentas.length}
        onClick={handleDeleteSelected}
      />
    </div>
  );

  const renderHeader = () => (
    <div className="deprati-table-header flex flex-wrap gap-2 align-items-center justify-content-between">
      <h4 className="deprati-title m-0">Gestión de Ventas Deprati</h4>
      <span className="deprati-search p-input-icon-left">
        <i className="pi pi-search" />
        <InputText
          value={globalFilter}
          onChange={(e) => {
            const value = e.target.value;
            setGlobalFilter(value);
            if (value) {
              const filtered = ventas.filter(item => (
                Object.values(item).some(val => val?.toString?.().toLowerCase().includes(value.toLowerCase()))
              ));
              setFilteredVentas(filtered);
            } else {
              setFilteredVentas([]);  // permanece vacío hasta filtrar
            }
          }}
          placeholder="Buscar..."
          className="deprati-search-input"
        />
      </span>
    </div>
  );

  const footer = `Total de ${filteredVentas ? filteredVentas.length : 0} ventas`;

  const actionBodyTemplate = (rowData) => (
    <div className="deprati-row-actions flex gap-2 justify-content-center">
      <Button
        icon="pi pi-pencil"
        className="p-button-rounded p-button-outlined p-button-info deprati-action-button deprati-edit-button"
        onClick={() => handleEdit(rowData)}
        tooltip="Editar"
        tooltipOptions={{ position: 'top' }}
      />
      <Button
        icon="pi pi-trash"
        className="p-button-rounded p-button-outlined p-button-danger deprati-action-button deprati-delete-button"
        onClick={() => handleDelete(rowData.id)}
        tooltip="Eliminar"
        tooltipOptions={{ position: 'top' }}
      />
    </div>
  );

  const handleEdit = (venta) => {
    if (editVenta !== null) return;
    if (!venta?.id) {
      showError("No se puede editar: venta inválida");
      return;
    }
    setEditVenta({ ...venta });
  };

  const handleFormSubmit = async (e) => {
    e.preventDefault();
    if (!editVenta?.id) {
      showError("No se puede editar la venta: datos inválidos");
      return;
    }
    setIsSaving(true);
    try {
      const res = await fetch(`/api-sellout/deprati/venta/${editVenta.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editVenta)
      });
      if (!res.ok) throw new Error("Error al editar la venta");
      setEditVenta(null);
      showSuccess("Venta actualizada exitosamente");
      await loadVentas();
      handleApplyFilters();
    } catch (e2) {
      console.error(e2);
      showError(e2.message || "Error al editar la venta");
    } finally {
      setIsSaving(false);
    }
  };

  // ==== Diálogo de mapeo ====
  const MapeoExcelDialog = () => (
    <Dialog
      visible={mapeoExcelDialogVisible}
      onHide={() => setMapeoExcelDialogVisible(false)}
      header="Confirmar carga de archivo"
      style={{ width: '30vw', maxWidth: 520 }}
      modal
      closable={false}
      dismissableMask
      footer={
        <div className="flex justify-content-end gap-2">
          <Button
            label="Cancelar"
            icon="pi pi-times"
            onClick={() => { setMapeoExcelDialogVisible(false); setSelectedFile(null); }}
            className="p-button-outlined p-button-secondary"
          />
          <Button
            label="Procesar Archivo"
            icon="pi pi-check"
            onClick={() => { setMapeoExcelDialogVisible(false); if (selectedFile) handleUploadWithMapeo(selectedFile); }}
            className="p-button-primary"
            disabled={!selectedFile}
          />
        </div>
      }
    >
      <div className="p-3 text-center">
        <i className="pi pi-exclamation-triangle text-3xl text-primary mb-3" />
        <p className="text-xl font-semibold">¿Está seguro que desea subir este archivo?</p>
        <p className="text-sm text-secondary">Se procesarán los datos automáticamente con los encabezados detectados.</p>
      </div>
    </Dialog>
  );

  return (
    <div className="deprati-layout-wrapper">
      <Toast ref={toast} position="top-right" className="toast-on-top" />
      <ConfirmDialog />

      {/* Overlay con cronómetro/ETA */}
      {loadingTemplate && (
        <div
          className="deprati-loader-overlay"
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.55)", // más visible
            zIndex: 9999,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexDirection: "column"
          }}
        >
          <ProgressSpinner className="deprati-spinner" />
          <div className="mt-3 text-white font-bold deprati-loading-text" style={{ fontSize: 18 }}>
            Procesando archivo…
          </div>
          <div className="mt-2 text-white" style={{ fontFamily: "monospace" }}>
            DEPRATI: {countdownText || "--:--"} | Transcurrido: {new Date(elapsedMs).toISOString().substr(11, 8)}
          </div>
        </div>
      )}

      <MapeoExcelDialog />

      <div className="deprati-card card">
        <h1 className="deprati-main-title text-center text-primary my-4">Ventas Deprati</h1>

        <Toolbar className="deprati-toolbar mb-4" left={leftToolbarTemplate} right={rightToolbarTemplate} />

        <Card className="deprati-filter-card mb-4">
          <h3 className="deprati-section-title text-primary mb-3">Filtros de Búsqueda</h3>
          <div className="grid formgrid">
            <div className="col-12 md:col-3 field">
              <label htmlFor="filterYear" className="deprati-label font-bold block mb-2">Año</label>
              <Dropdown
                id="filterYear"
                value={filterYear}
                options={years.map(y => ({ label: String(y), value: y }))}
                onChange={(e) => setFilterYear(e.value)}
                placeholder="Seleccionar Año"
                className="deprati-dropdown w-full"
              />
            </div>
            <div className="col-12 md:col-3 field">
              <label htmlFor="filterMonth" className="deprati-label font-bold block mb-2">Mes</label>
              <Dropdown
                id="filterMonth"
                value={filterMonth}
                options={months}
                onChange={(e) => setFilterMonth(e.value)}
                placeholder="Seleccionar Mes"
                className="deprati-dropdown w-full"
              />
            </div>
            <div className="col-12 md:col-3 field">
              <label htmlFor="filterMarca" className="deprati-label font-bold block mb-2">Marca</label>
              <Dropdown
                id="filterMarca"
                value={filterMarca}
                options={marcas.map(m => ({ label: m, value: m }))}
                onChange={(e) => setFilterMarca(e.value)}
                placeholder="Seleccionar Marca"
                className="deprati-dropdown w-full"
              />
            </div>
            <div className="col-12 md:col-3 field">
              <label htmlFor="filterDate" className="deprati-label font-bold block mb-2">Fecha Específica</label>
              <Calendar
                id="filterDate"
                value={filterDate}
                onChange={(e) => setFilterDate(e.value)}
                dateFormat="dd/mm/yy"
                placeholder="Seleccione la Fecha"
                className="deprati-calendar w-full"
                showIcon
                inputClassName="text-black font-bold"
              />
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
              severity="secondary"
              onClick={handleClearFilters}
              className="p-button-raised p-button-outlined deprati-button deprati-button-clear"
            />
          </div>
        </Card>

        <div className="card">
          <DataTable
            value={filteredVentas}
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
            selectionMode={rowClick ? null : 'checkbox'}
            selection={selectedVentas}
            onSelectionChange={(e) => {
              if (e.value.length > 5000) {
                showWarn("Solo puede seleccionar un máximo de 5000 registros para eliminar.");
                setSelectedVentas(e.value.slice(0, 5000));
              } else {
                setSelectedVentas(e.value);
              }
            }}
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

export default Deprati;
