import React, { useEffect, useRef, useState, useMemo } from "react";
import "./css/fybeca.css";
import { Toast } from "primereact/toast";
import { ConfirmDialog, confirmDialog } from "primereact/confirmdialog";
import { Toolbar } from "primereact/toolbar";
import { DataTable } from "primereact/datatable";
import { Column } from "primereact/column";
import { Button } from "primereact/button";
import { InputText } from "primereact/inputtext";
import { Dialog } from "primereact/dialog";
import { ProgressSpinner } from "primereact/progressspinner";
import "primereact/resources/themes/lara-light-indigo/theme.css";
import "primereact/resources/primereact.min.css";
import "primeicons/primeicons.css";
import "primeflex/primeflex.css";

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

export function showDeletionOutcome({ eliminados, bloqueados, bloqueadosInfo, message }, showSuccess, showWarn, showInfo) {
  if (eliminados?.length) {
    showSuccess(`Eliminados: ${eliminados.length}`);
  }
  if (bloqueados?.length) {
    const detalle = (bloqueadosInfo && bloqueadosInfo.length)
      ? bloqueadosInfo.map((p) => `ID ${p.id} (Item: ${p.codItem ?? "-"}, Barra: ${p.codBarraSap ?? "-"})`).join("; ")
      : `IDs: ${bloqueados.join(", ")}`;
    const motivo = /ventas asociadas/i.test(message)
      ? "Tiene ventas asociadas"
      : "Restricción de integridad referencial";
    showWarn(`No se pudieron eliminar ${bloqueados.length} producto(s). Motivo: ${motivo}. ${detalle}`);
  }
  if (!eliminados?.length && !bloqueados?.length) {
    showInfo(message || "Operación completada");
  }
}
// ======================================================================================

const FybecaMantenimientoProducto = () => {
  const toast = useRef(null);
  const fileInputRef = useRef(null);

  const [productos, setProductos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [globalFilter, setGlobalFilter] = useState("");

  // 🔹 Selección tipo Fybeca: IDs, no objetos
  const [selectedProductos, setSelectedProductos] = useState([]);

  const [editProducto, setEditProducto] = useState(null);
  const [showDialog, setShowDialog] = useState(false);
  const [file, setFile] = useState(null);

  const [paginatorState, setPaginatorState] = useState({
    first: 0,
    rows: 10,
    totalRecords: 0,
  });

  const showToast = ({ type = "info", summary, detail, life = 3000 }) => {
    toast.current?.show({ severity: type, summary, detail, life });
  };
  const showSuccess = (m) => showToast({ type: "success", summary: "Éxito", detail: m });
  const showInfo = (m) => showToast({ type: "info", summary: "Información", detail: m });
  const showWarn = (m) => showToast({ type: "warn", summary: "Advertencia", detail: m });
  const showError = (m) => showToast({ type: "error", summary: "Error", detail: m });

  const loadProductos = async () => {
    setLoading(true);
    setError(null);
    try {
      const resp = await fetch("/api-sellout/fybeca/productos");
      if (!resp.ok) throw new Error("Error al obtener los productos");
      const data = await resp.json();
      setProductos(data);
      setPaginatorState((p) => ({ ...p, totalRecords: data.length, first: 0 }));
      setSelectedProductos([]);
    } catch (e) {
      setError(e.message);
      showError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadProductos();
  }, []);

  const onEdit = (row) => {
    setEditProducto({ ...row });
    setShowDialog(true);
  };

  const onSaveProducto = async () => {
    try {
      const resp = await fetch("/api-sellout/fybeca/producto", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editProducto),
      });
      if (!resp.ok) throw new Error("Error al guardar el producto");
      showSuccess("Producto guardado correctamente");
      setShowDialog(false);
      setEditProducto(null);
      await loadProductos();
    } catch (e) {
      showError(e.message);
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
            setSelectedProductos((prev) => prev.filter((pid) => pid !== id));
            setPaginatorState((p) => ({ ...p, totalRecords: Math.max(0, p.totalRecords - 1) }));
          }

          showDeletionOutcome(result, showSuccess, showWarn, showInfo);
        } catch (e) {
          showError(e.message || "Error al eliminar el producto");
        }
      },
    });
  };

  // =================== BORRADO MASIVO ===================
  const onDeleteSelected = () => {
    if (!selectedProductos?.length) {
      showInfo("No hay productos seleccionados");
      return;
    }
    confirmDialog({
      message: `¿Está seguro de eliminar ${selectedProductos.length} producto(s)?`,
      header: "Confirmación",
      icon: "pi pi-exclamation-triangle",
      acceptLabel: "Sí, eliminar",
      rejectLabel: "Cancelar",
      acceptClassName: "p-button-danger",
      accept: async () => {
        try {
          const ids = selectedProductos;
          const batchSize = 1000;
          let eliminadosTotal = [];
          let bloqueadosTotal = [];
          let bloqueadosInfoTotal = [];
          let messages = [];

          for (let i = 0; i < ids.length; i += batchSize) {
            const batch = ids.slice(i, i + batchSize);
            const resp = await fetch("/api-sellout/fybeca/productos", {
              method: "DELETE",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(batch),
            });
            const result = await parseDeleteResponse(resp);
            eliminadosTotal = eliminadosTotal.concat(result.eliminados || []);
            bloqueadosTotal = bloqueadosTotal.concat(result.bloqueados || []);
            bloqueadosInfoTotal = bloqueadosInfoTotal.concat(result.bloqueadosInfo || []);
            if (result.message) messages.push(result.message);
          }

          const removeSet = new Set(eliminadosTotal);
          setProductos((prev) => prev.filter((p) => !removeSet.has(p.id)));
          setSelectedProductos([]);
          setPaginatorState((p) => ({
            ...p,
            totalRecords: Math.max(0, p.totalRecords - eliminadosTotal.length),
          }));

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
          showError(e.message || "Error al eliminar productos");
        }
      },
    });
  };

  // ========= Selección masiva estilo Fybeca =========
  const globalFilterFields = ["codItem", "codBarraSap", "id"];

  const visibleProductos = useMemo(() => {
    const query = (globalFilter || "").toLowerCase().trim();
    if (!query) return productos;
    return productos.filter((p) =>
      globalFilterFields.some((f) => {
        const val = f.includes(".") ? f.split(".").reduce((acc, k) => (acc ? acc[k] : undefined), p) : p[f];
        return String(val ?? "").toLowerCase().includes(query);
      })
    );
  }, [productos, globalFilter]);

  const allVisibleIds = useMemo(() => visibleProductos.map((p) => p.id), [visibleProductos]);

  const areAllVisibleSelected = allVisibleIds.length > 0 && allVisibleIds.every((id) => selectedProductos.includes(id));

  const handleSelectProducto = (id) => {
    setSelectedProductos((prev) => (prev.includes(id) ? prev.filter((pid) => pid !== id) : [...prev, id]));
  };

  const handleSelectAll = () => {
    if (areAllVisibleSelected) {
      setSelectedProductos((prev) => prev.filter((id) => !allVisibleIds.includes(id)));
    } else {
      setSelectedProductos((prev) => {
        const setPrev = new Set(prev);
        allVisibleIds.forEach((id) => setPrev.add(id));
        return Array.from(setPrev);
      });
    }
  };

  const selectionHeaderTemplate = () => (
    <div className="flex justify-content-center">
      <input type="checkbox" checked={areAllVisibleSelected} onChange={handleSelectAll} className="p-checkbox" aria-label="Seleccionar todo" />
    </div>
  );

  const selectionBodyTemplate = (rowData) => (
    <div className="flex justify-content-center">
      <input type="checkbox" checked={selectedProductos.includes(rowData.id)} onChange={() => handleSelectProducto(rowData.id)} className="p-checkbox" aria-label={`Seleccionar ${rowData.id}`} />
    </div>
  );
  // ==================================================

  // =================== SUBIDA / REPORTE ===================
  const onUpload = async () => {
    if (!file) {
      showWarn("Seleccione un archivo XLSX primero");
      return;
    }
    setLoading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const resp = await fetch("/api-sellout/fybeca/template-productos", { method: "POST", body: formData });
      if (!resp.ok) throw new Error("Error al cargar el archivo");
      const msg = await resp.text();
      showSuccess(msg || "Archivo procesado");
      setFile(null);
      await loadProductos();
    } catch (e) {
      showError(e.message);
    } finally {
      setLoading(false);
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
      showError(e.message);
    }
  };
  // ========================================================

  // =================== ACCIONES / HEADER ===================
  const actionTemplate = (row) => (
    <div className="flex gap-2 justify-content-center">
      <Button icon="pi pi-pencil" className="p-button-rounded p-button-success p-button-outlined" onClick={() => onEdit(row)} tooltip="Editar" />
      <Button icon="pi pi-trash" className="p-button-rounded p-button-danger p-button-outlined" onClick={() => deleteSingleProducto(row.id)} tooltip="Eliminar" />
    </div>
  );

  const header = (
    <div className="flex flex-wrap align-items-center justify-content-between w-full">
      <h3 className="m-0">Productos</h3>
      <span className="p-input-icon-left">
        <i className="pi pi-search" />
        <InputText
          value={globalFilter}
          onChange={(e) => {
            setGlobalFilter(e.target.value);
            setPaginatorState((p) => ({ ...p, first: 0 }));
          }}
          placeholder="Buscar por cualquier campo"
        />
      </span>
    </div>
  );
  // ========================================================

  return (
    <div className="container">
      <Toast ref={toast} />
      <ConfirmDialog />
      <h1>Mantenimiento Producto</h1>

      <Toolbar
        className="mb-3"
        left={
          <Button label="Eliminar Seleccionados" icon="pi pi-trash" className="p-button-danger" onClick={onDeleteSelected} disabled={!selectedProductos?.length} />
        }
        right={
          <div className="flex flex-wrap gap-2">
            <Button label="Importar XLSX" icon="pi pi-upload" className="p-button-help" onClick={() => fileInputRef.current?.click()} />
            <input ref={fileInputRef} type="file" accept=".xlsx,.xls,.csv" onChange={(e) => setFile(e.target.files?.[0] || null)} style={{ display: "none" }} />
            <Button label="Cargar" icon="pi pi-check" onClick={onUpload} disabled={!file} />
            <a href="/TEMPLATE CODIGOS BARRA Y ITEM.xlsx" download>
              <Button label="Descargar Template" icon="pi pi-download" className="p-button-info" />
            </a>
            <Button label="Reporte" icon="pi pi-file-excel" className="p-button-success" onClick={onGenerateReport} />
          </div>
        }
      />

      {loading ? (
        <div className="flex justify-content-center align-items-center" style={{ height: 200 }}>
          <ProgressSpinner style={{ width: 50, height: 50 }} />
        </div>
      ) : error ? (
        <p className="error">Error: {error}</p>
      ) : (
        <DataTable
          value={visibleProductos}
          header={header}
          paginator
          rows={paginatorState.rows}
          rowsPerPageOptions={[5, 10, 25, 50, 100]}
          totalRecords={visibleProductos.length}
          first={paginatorState.first}
          onPage={(e) => setPaginatorState((p) => ({ ...p, first: e.first, rows: e.rows }))}
          dataKey="id"
          responsiveLayout="scroll"
          showGridlines
          stripedRows
          removableSort
          emptyMessage="No hay productos disponibles."
          className="p-datatable-sm"
        >
          <Column header={selectionHeaderTemplate} body={selectionBodyTemplate} style={{ width: "3rem" }} exportable={false} />
          <Column field="codItem" header="Código Item" sortable />
          <Column field="codBarraSap" header="Código Barra SAP" sortable />
          <Column body={actionTemplate} header="Acciones" style={{ width: "8rem" }} />
        </DataTable>
      )}

      <Dialog
        key={editProducto?.id || "new"}
        visible={showDialog}
        onHide={() => setShowDialog(false)}
        header="Editar Producto"
        modal
        style={{ width: "40rem" }}
        footer={
          <div className="flex justify-content-end gap-2">
            <Button label="Cancelar" icon="pi pi-times" className="p-button-text" onClick={() => setShowDialog(false)} />
            <Button label="Guardar" icon="pi pi-check" onClick={onSaveProducto} />
          </div>
        }
      >
        {editProducto && (
          <div className="grid formgrid p-fluid">
            <div className="field col-12">
              <label htmlFor="codItem" className="block mb-2">Código Item</label>
              <InputText id="codItem" value={editProducto.codItem || ""} onChange={(e) => setEditProducto({ ...editProducto, codItem: e.target.value })} />
            </div>
            <div className="field col-12">
              <label htmlFor="codBarraSap" className="block mb-2">Código Barra SAP</label>
              <InputText id="codBarraSap" value={editProducto.codBarraSap || ""} onChange={(e) => setEditProducto({ ...editProducto, codBarraSap: e.target.value })} />
            </div>
          </div>
        )}
      </Dialog>
    </div>
  );
};

export default FybecaMantenimientoProducto;
