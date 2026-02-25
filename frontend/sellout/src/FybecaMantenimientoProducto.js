import React, { useEffect, useMemo, useRef, useState } from "react";
import "./css/deprati.css";
import "./css/fybeca.css";

import { Toast } from "primereact/toast";
import { ConfirmDialog, confirmDialog } from "primereact/confirmdialog";
import { Toolbar } from "primereact/toolbar";
import { Card } from "primereact/card";
import { Divider } from "primereact/divider";
import { DataTable } from "primereact/datatable";
import { Column } from "primereact/column";
import { Button } from "primereact/button";
import { InputText } from "primereact/inputtext";
import { Calendar } from "primereact/calendar";
import { InputNumber } from "primereact/inputnumber";
import { Dialog } from "primereact/dialog";
import { ProgressSpinner } from "primereact/progressspinner";

// ===================== Helpers para manejo de respuesta de borrado =====================
export async function parseDeleteResponse(resp) {
  // 1) Intentar JSON
  try {
    const data = await resp.clone().json();
    if (data && (Array.isArray(data.eliminados) || Array.isArray(data.bloqueados))) {
      return {
        eliminados: data.eliminados || [],
        bloqueados: data.bloqueados || [],
        bloqueadosInfo: data.bloqueadosInfo || [],
        message: data.message || "Operación completada",
      };
    }
  } catch (_) {}

  // 2) Intentar texto (caso error 500 con mensaje)
  let txt = "";
  try {
    txt = await resp.text();
  } catch (_) {}

  const ids = [];
  const m = txt.match(/\[(.*?)\]/);
  if (m && m[1]) {
    m[1].split(",").forEach((s) => {
      const n = parseInt(s.trim(), 10);
      if (!Number.isNaN(n)) ids.push(n);
    });
  }

  const motivo = /ventas asociadas|FOREIGN KEY|REFERENCE/i.test(txt)
    ? "Tiene ventas asociadas"
    : "Restricción de integridad referencial";

  return {
    eliminados: [],
    bloqueados: ids,
    bloqueadosInfo: ids.map((id) => ({ id })),
    message: txt || `No se pudieron eliminar algunos productos. Motivo: ${motivo}`,
  };
}

export function showDeletionOutcome(
  { eliminados, bloqueados, bloqueadosInfo, message },
  showSuccess,
  showWarn,
  showInfo
) {
  if (eliminados?.length) showSuccess(`Eliminados: ${eliminados.length}`);

  if (bloqueados?.length) {
    const detalle =
      bloqueadosInfo && bloqueadosInfo.length
        ? bloqueadosInfo
            .map((p) => `ID ${p.id} (Item: ${p.codItem ?? "-"}, Barra: ${p.codBarraSap ?? "-"})`)
            .join("; ")
        : `IDs: ${bloqueados.join(", ")}`;

    const motivo = /ventas asociadas/i.test(message)
      ? "Tiene ventas asociadas"
      : "Restricción de integridad referencial";

    showWarn(`No se pudieron eliminar ${bloqueados.length} producto(s). Motivo: ${motivo}. ${detalle}`);
  }

  if (!eliminados?.length && !bloqueados?.length) showInfo(message || "Operación completada");
}
// ======================================================================================

const FybecaMantenimientoProducto = () => {
  const toast = useRef(null);
  const fileInputRef = useRef(null);

  const [productos, setProductos] = useState([]);
  const [loading, setLoading] = useState(false);
  const [loadingOverlay, setLoadingOverlay] = useState(false);
  const [error, setError] = useState(null);

  // selección (objetos para DataTable, igual que Deprati/RM)
  const [selectedProductos, setSelectedProductos] = useState([]);

  // edición
  const [editProducto, setEditProducto] = useState(null);
  const [isSaving, setIsSaving] = useState(false);

  // upload
  const [file, setFile] = useState(null);

  // filtros
  const [globalFilter, setGlobalFilter] = useState("");
  const [filterYear, setFilterYear] = useState(null);
  const [filterMonth, setFilterMonth] = useState(null);
  const [filterDay, setFilterDay] = useState(null);
  const [filterMarca, setFilterMarca] = useState("");
  const [filterDateRange, setFilterDateRange] = useState(null);

  // paginator
  const [paginatorState, setPaginatorState] = useState({ first: 0, rows: 50 });

  // ===== Toast helpers (mismo estilo) =====
  const showToast = ({ type = "info", summary, detail, life = 3500, content, sticky, className }) =>
    toast.current?.show({ severity: type, summary, detail, life, content, sticky, className });

  const showSuccess = (m) => showToast({ type: "success", summary: "Éxito", detail: m });
  const showInfo = (m) => showToast({ type: "info", summary: "Información", detail: m });
  const showWarn = (m) => showToast({ type: "warn", summary: "Advertencia", detail: m });
  const showError = (m) => showToast({ type: "error", summary: "Error", detail: m, life: 9000 });

  const safeLower = (v) => String(v ?? "").toLowerCase();

  const loadProductos = async () => {
    setLoading(true);
    setError(null);
    try {
      const resp = await fetch("/api-sellout/fybeca/productos");
      if (!resp.ok) throw new Error("Error al obtener los productos");
      const data = await resp.json();
      const list = Array.isArray(data) ? data : [];
      setProductos(list);
      setSelectedProductos([]);
      setPaginatorState((p) => ({ ...p, first: 0 }));
    } catch (e) {
      setError(e?.message || String(e));
      showError(e?.message || String(e));
      setProductos([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadProductos();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ===== Filtrado local + búsqueda global =====
  const visibleProductos = useMemo(() => {
    let base = [...productos];

    base = base.filter((p) => {
      const anio = Number(p.anio ?? p.year);
      const mes = Number(p.mes ?? p.month);
      const dia = Number(p.dia ?? p.day);

      if (filterYear != null && Number.isFinite(anio) && anio !== Number(filterYear)) return false;
      if (filterMonth != null && Number.isFinite(mes) && mes !== Number(filterMonth)) return false;
      if (filterDay != null && Number.isFinite(dia) && dia !== Number(filterDay)) return false;

      if (filterMarca && safeLower(p.marca ?? p?.producto?.marca ?? "") !== safeLower(filterMarca)) return false;

      if (filterDateRange && Array.isArray(filterDateRange)) {
        const [from, to] = filterDateRange;
        if (from || to) {
          const itemDate = new Date(
            Number(p.anio ?? p.year ?? 1970),
            Number((p.mes ?? p.month ?? 1)) - 1,
            Number(p.dia ?? p.day ?? 1)
          );

          if (from) {
            const df = new Date(from);
            const f = new Date(df.getFullYear(), df.getMonth(), df.getDate());
            if (itemDate < f) return false;
          }
          if (to) {
            const dt = new Date(to);
            const t = new Date(dt.getFullYear(), dt.getMonth(), dt.getDate());
            if (itemDate > t) return false;
          }
        }
      }
      return true;
    });

    const gf = globalFilter?.trim();
    if (gf) {
      const q = gf.toLowerCase();
      base = base.filter((p) => {
        const hay =
          safeLower(p.codItem).includes(q) ||
          safeLower(p.codBarraSap).includes(q) ||
          safeLower(p.id).includes(q) ||
          safeLower(p.marca).includes(q);
        return hay;
      });
    }

    return base;
  }, [productos, globalFilter, filterYear, filterMonth, filterDay, filterMarca, filterDateRange]);

  // ===== CRUD =====
  const onEdit = (row) => setEditProducto({ ...row });

  const onSaveProducto = async () => {
    if (!editProducto) return;
    setIsSaving(true);
    try {
      const resp = await fetch("/api-sellout/fybeca/producto", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editProducto),
      });
      if (!resp.ok) throw new Error("Error al guardar el producto");
      showSuccess("Producto guardado correctamente");
      setEditProducto(null);
      await loadProductos();
    } catch (e) {
      showError(e?.message || String(e));
    } finally {
      setIsSaving(false);
    }
  };

  // =================== BORRADO INDIVIDUAL ===================
  const deleteSingleProducto = (id) => {
    confirmDialog({
      message: "¿Está seguro de eliminar este producto?",
      header: "Confirmación",
      icon: "pi pi-exclamation-triangle",
      acceptLabel: "Sí, eliminar",
      rejectLabel: "Cancelar",
      acceptClassName: "p-button-danger",
      closable: false,
      accept: async () => {
        try {
          const resp = await fetch("/api-sellout/fybeca/productos", {
            method: "DELETE",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify([id]),
          });

          const result = await parseDeleteResponse(resp);

          if (result.eliminados?.includes(id)) {
            setProductos((prev) => prev.filter((p) => p.id !== id));
            setSelectedProductos((prev) => prev.filter((p) => p.id !== id));
          }

          showDeletionOutcome(result, showSuccess, showWarn, showInfo);
        } catch (e) {
          showError(e?.message || "Error al eliminar el producto");
        }
      },
    });
  };

  // =================== BORRADO MASIVO ===================
  const onDeleteSelected = () => {
    if (!selectedProductos?.length) return showInfo("No hay productos seleccionados");

    confirmDialog({
      message: `¿Está seguro de eliminar ${selectedProductos.length} producto(s)?`,
      header: "Confirmación",
      icon: "pi pi-exclamation-triangle",
      acceptLabel: "Sí, eliminar",
      rejectLabel: "Cancelar",
      acceptClassName: "p-button-danger",
      closable: false,
      accept: async () => {
        try {
          const ids = selectedProductos.map((p) => p.id).filter(Boolean);
          const batchSize = 1000;

          let eliminadosTotal = [];
          let bloqueadosTotal = [];
          let bloqueadosInfoTotal = [];
          let messages = [];

          for (let i = 0; i < ids.length; i += batchSize) {
            const batch = ids.slice(i, i + batchSize);
            // eslint-disable-next-line no-await-in-loop
            const resp = await fetch("/api-sellout/fybeca/productos", {
              method: "DELETE",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(batch),
            });
            // eslint-disable-next-line no-await-in-loop
            const result = await parseDeleteResponse(resp);

            eliminadosTotal = eliminadosTotal.concat(result.eliminados || []);
            bloqueadosTotal = bloqueadosTotal.concat(result.bloqueados || []);
            bloqueadosInfoTotal = bloqueadosInfoTotal.concat(result.bloqueadosInfo || []);
            if (result.message) messages.push(result.message);
          }

          const removeSet = new Set(eliminadosTotal);
          setProductos((prev) => prev.filter((p) => !removeSet.has(p.id)));
          setSelectedProductos([]);

          showDeletionOutcome(
            {
              eliminados: eliminadosTotal,
              bloqueados: bloqueadosTotal,
              bloqueadosInfo: bloqueadosInfoTotal,
              message: messages.join(" | "),
            },
            showSuccess,
            showWarn,
            showInfo
          );
        } catch (e) {
          showError(e?.message || "Error al eliminar productos");
        }
      },
    });
  };

  // =================== SUBIDA / REPORTE ===================
  const onUpload = async () => {
    if (!file) return showWarn("Seleccione un archivo XLSX primero");

    setLoadingOverlay(true);
    try {
      const formData = new FormData();
      formData.append("file", file);

      const resp = await fetch("/api-sellout/fybeca/template-productos", {
        method: "POST",
        body: formData,
      });

      if (!resp.ok) throw new Error("Error al cargar el archivo");
      const msg = await resp.text();

      showSuccess(msg || "Archivo procesado");
      setFile(null);
      await loadProductos();
    } catch (e) {
      showError(e?.message || String(e));
    } finally {
      setLoadingOverlay(false);
    }
  };

  const onGenerateReport = async () => {
    try {
      const response = await fetch("/api-sellout/fybeca/reporte-productos", { method: "GET" });
      if (!response.ok) throw new Error("Error al generar el reporte");

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "reporte_productos.xlsx";
      a.click();
      URL.revokeObjectURL(url);

      showSuccess("Reporte generado correctamente");
    } catch (e) {
      showError(e?.message || String(e));
    }
  };

  // =================== UI ===================
  const renderHeader = () => (
    <div className="deprati-table-header flex flex-wrap gap-2 align-items-center justify-content-between">
      <h4 className="deprati-title m-0">Mantenimiento Productos Fybeca</h4>
      <span className="deprati-search p-input-icon-left">
        <i className="pi pi-search" />
        <InputText
          value={globalFilter}
          onChange={(e) => {
            setGlobalFilter(e.target.value || "");
            setPaginatorState((p) => ({ ...p, first: 0 }));
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
        label="Eliminar Seleccionados"
        icon="pi pi-trash"
        className="p-button-danger"
        onClick={onDeleteSelected}
        disabled={!selectedProductos?.length}
      />
    </div>
  );

  const rightToolbarTemplate = () => (
    <div className="deprati-toolbar-right flex flex-wrap align-items-center gap-3">
      <Button
        label="Importar XLSX"
        icon="pi pi-upload"
        className="p-button-help p-button-raised"
        onClick={() => fileInputRef.current?.click()}
      />
      <input
        ref={fileInputRef}
        type="file"
        accept=".xlsx,.xls,.csv"
        style={{ display: "none" }}
        onChange={(e) => setFile(e.target.files?.[0] || null)}
      />

      <Button
        label="Cargar"
        icon="pi pi-check"
        className="p-button-primary p-button-raised"
        onClick={onUpload}
        disabled={!file}
      />

      <Button
        label="Descargar Template"
        icon="pi pi-download"
        className="p-button-raised p-button-warning"
        onClick={() => {
          const url = encodeURI("/TEMPLATE CODIGOS BARRA Y ITEM.xlsx");
          const a = document.createElement("a");
          a.href = url;
          a.download = "TEMPLATE CODIGOS BARRA Y ITEM.xlsx";
          a.click();
        }}
      />

      <Button
        label="Reporte"
        icon="pi pi-file-excel"
        className="p-button-success p-button-raised"
        onClick={onGenerateReport}
      />
    </div>
  );

  const actionTemplate = (row) => (
    <div className="deprati-row-actions flex gap-2 justify-content-center">
      <Button
        icon="pi pi-pencil"
        className="p-button-rounded p-button-outlined p-button-info"
        onClick={() => onEdit(row)}
        tooltip="Editar"
        aria-label="Editar"
      />
      <Button
        icon="pi pi-trash"
        className="p-button-rounded p-button-outlined p-button-danger"
        onClick={() => deleteSingleProducto(row.id)}
        tooltip="Eliminar"
        aria-label="Eliminar"
      />
    </div>
  );

  return (
    <div className="deprati-layout-wrapper">
      <Toast ref={toast} position="top-right" className="toast-on-top" />
      <ConfirmDialog />

      {/* Overlay de carga (como los otros módulos) */}
      {loadingOverlay && (
        <div className="fixed top-0 left-0 w-full h-full flex justify-content-center align-items-center bg-black-alpha-70 z-5">
          <div
            className="surface-card p-5 border-round shadow-2 text-center"
            style={{ minWidth: 360, backgroundColor: "rgba(0,0,0,0.85)" }}
          >
            <ProgressSpinner style={{ width: "60px", height: "60px" }} />
            <div className="mt-3" style={{ fontWeight: "bold", color: "white", fontSize: "1.2rem" }}>
              Procesando archivo...
            </div>
            <div className="mt-3">
              <Button
                label="Cerrar"
                icon="pi pi-times"
                className="p-button-text p-button-danger"
                onClick={() => setLoadingOverlay(false)}
              />
            </div>
          </div>
        </div>
      )}

      <div className="deprati-card card">
        <h1 className="deprati-main-title text-center text-primary my-4">Mantenimiento Producto</h1>

        <Toolbar className="deprati-toolbar mb-4" left={leftToolbarTemplate} right={rightToolbarTemplate} />

        {/* Filtros */}
        <Card className="deprati-filter-card mb-4">
          <h3 className="deprati-section-title text-primary mb-3">Filtros</h3>

          <div className="grid formgrid">
            <div className="flex flex-wrap gap-8 align-items-end">
              <div className="field">
                <label className="deprati-label font-bold block mb-2">Año</label>
                <InputNumber
                  value={filterYear}
                  onValueChange={(e) => setFilterYear(e.value != null ? Number(e.value) : null)}
                  useGrouping={false}
                  min={1900}
                  max={2100}
                  className="w-12rem"
                  placeholder="Año"
                />
              </div>

              <div className="field">
                <label className="deprati-label font-bold block mb-2">Mes</label>
                <InputNumber
                  value={filterMonth}
                  onValueChange={(e) => setFilterMonth(e.value != null ? Number(e.value) : null)}
                  useGrouping={false}
                  min={1}
                  max={12}
                  className="w-12rem"
                  placeholder="Mes"
                />
              </div>

              <div className="field">
                <label className="deprati-label font-bold block mb-2">Día</label>
                <InputNumber
                  value={filterDay}
                  onValueChange={(e) => setFilterDay(e.value != null ? Number(e.value) : null)}
                  useGrouping={false}
                  min={1}
                  max={31}
                  className="w-12rem"
                  placeholder="Día"
                />
              </div>

              <div className="field">
                <label className="deprati-label font-bold block mb-2">Marca</label>
                <InputText
                  value={filterMarca}
                  onChange={(e) => setFilterMarca(e.target.value || "")}
                  className="deprati-search-input w-12rem"
                  placeholder="Marca"
                />
              </div>

              <div className="field">
                <label className="deprati-label font-bold block mb-2">Rango de Fecha</label>
                <Calendar
                  value={filterDateRange}
                  onChange={(e) => setFilterDateRange(e.value || null)}
                  selectionMode="range"
                  readOnlyInput
                  placeholder="Seleccione rango"
                  dateFormat="dd/mm/yy"
                  className="deprati-calendar w-16rem"
                  showIcon
                />
              </div>
            </div>
          </div>

          <Divider className="deprati-divider" />

          <div className="deprati-filter-actions flex justify-content-end gap-3 mt-3">
            <Button
              label="Limpiar"
              icon="pi pi-times"
              className="p-button-raised p-button-outlined deprati-button deprati-button-clear"
              onClick={() => {
                setFilterYear(null);
                setFilterMonth(null);
                setFilterDay(null);
                setFilterMarca("");
                setFilterDateRange(null);
                setGlobalFilter("");
                setPaginatorState((p) => ({ ...p, first: 0 }));
                showInfo("Filtros limpiados");
              }}
            />
          </div>
        </Card>

        {/* Tabla */}
        <div className="card">
          <DataTable
            value={visibleProductos}
            dataKey="id"
            paginator
            rows={paginatorState.rows}
            first={paginatorState.first}
            onPage={(e) => setPaginatorState((p) => ({ ...p, first: e.first, rows: e.rows }))}
            rowsPerPageOptions={[50, 100, 150, 200]}
            responsiveLayout="scroll"
            stripedRows
            showGridlines
            header={renderHeader}
            emptyMessage={error ? `Error: ${error}` : "No hay productos disponibles."}
            loading={loading}
            selection={selectedProductos}
            onSelectionChange={(e) => {
              const value = e.value || [];
              if (value.length > 5000) {
                showWarn("Solo puede seleccionar un máximo de 5000 registros.");
                setSelectedProductos(value.slice(0, 5000));
              } else {
                setSelectedProductos(value);
              }
            }}
            className="p-datatable-sm"
            tableStyle={{ minWidth: "50rem" }}
          >
            <Column selectionMode="multiple" headerStyle={{ width: "3rem" }} />
            <Column field="id" header="ID" sortable style={{ width: "8rem" }} />
            <Column field="codItem" header="Código Item" sortable />
            <Column field="codBarraSap" header="Código Barra SAP" sortable />
            <Column field="marca" header="Marca" sortable />
            <Column body={actionTemplate} exportable={false} header="Acciones" style={{ width: "10rem" }} />
          </DataTable>
        </div>

        {/* Dialog editar */}
        <Dialog
          visible={editProducto !== null}
          onHide={() => setEditProducto(null)}
          header="Editar Producto"
          className="deprati-edit-dialog p-fluid"
          style={{ width: "45vw", maxWidth: "900px" }}
          modal
          dismissableMask
        >
          {editProducto && (
            <div className="p-3">
              <div className="grid formgrid p-fluid">
                <div className="col-12">
                  <span className="p-float-label">
                    <InputText
                      id="codItem"
                      value={editProducto.codItem || ""}
                      onChange={(e) => setEditProducto((p) => ({ ...p, codItem: e.target.value }))}
                    />
                    <label htmlFor="codItem">Código Item</label>
                  </span>
                </div>

                <div className="col-12 mt-3">
                  <span className="p-float-label">
                    <InputText
                      id="codBarraSap"
                      value={editProducto.codBarraSap || ""}
                      onChange={(e) => setEditProducto((p) => ({ ...p, codBarraSap: e.target.value }))}
                    />
                    <label htmlFor="codBarraSap">Código Barra SAP</label>
                  </span>
                </div>
              </div>

              <div className="flex justify-content-end gap-2 mt-4">
                <Button
                  label="Cancelar"
                  icon="pi pi-times"
                  className="p-button-outlined p-button-secondary"
                  onClick={() => setEditProducto(null)}
                  type="button"
                />
                <Button
                  label={isSaving ? "Guardando..." : "Guardar"}
                  icon={isSaving ? "pi pi-spin pi-spinner" : "pi pi-check"}
                  className="p-button-primary"
                  onClick={onSaveProducto}
                  disabled={isSaving}
                  type="button"
                />
              </div>
            </div>
          )}
        </Dialog>
      </div>
    </div>
  );
};

export default FybecaMantenimientoProducto;
