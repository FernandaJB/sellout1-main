import React, { useEffect, useMemo, useRef, useState } from "react";
import "./css/deprati.css";
import "./css/fybeca.css";

import "primereact/resources/themes/lara-light-indigo/theme.css";
import "primereact/resources/primereact.min.css";
import "primeicons/primeicons.css";
import "primeflex/primeflex.css";

import { Toast } from "primereact/toast";
import { ConfirmDialog, confirmDialog } from "primereact/confirmdialog";
import { ProgressSpinner } from "primereact/progressspinner";
import { Toolbar } from "primereact/toolbar";
import { Card } from "primereact/card";
import { Divider } from "primereact/divider";
import { DataTable } from "primereact/datatable";
import { Column } from "primereact/column";
import { Button } from "primereact/button";
import { InputText } from "primereact/inputtext";
import { Dropdown } from "primereact/dropdown";
import { Dialog } from "primereact/dialog";

// ===================== Helpers de borrado (compatibles con API masiva/no-estándar) =====================
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
    message: txt || `No se pudieron eliminar algunos registros. Motivo: ${motivo}`,
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
        ? bloqueadosInfo.map((p) => `ID ${p.id} (PDV: ${p?.codPdv ?? "-"})`).join("; ")
        : `IDs: ${bloqueados.join(", ")}`;

    const motivo = /ventas asociadas/i.test(message)
      ? "Tiene ventas asociadas"
      : "Restricción de integridad referencial";

    showWarn(`No se pudieron eliminar ${bloqueados.length} registro(s). Motivo: ${motivo}. ${detalle}`);
  }

  if (!eliminados?.length && !bloqueados?.length) showInfo(message || "Operación completada");
}
// ======================================================================================

const COD_CLIENTE_FIJO = "MZCL-000014"; // Siempre filtrar por este codCliente

const FybecaTipoMueble = () => {
  const toast = useRef(null);
  const fileInputRef = useRef(null);

  const [tipoMuebles, setTipoMuebles] = useState([]);
  const [loading, setLoading] = useState(false);
  const [loadingUpload, setLoadingUpload] = useState(false);
  const [error, setError] = useState("");

  // ✅ filtros que SÍ quieres
  const [filterMarca, setFilterMarca] = useState(""); // búsqueda general por marca
  const [filterTipoMuebleEssence, setFilterTipoMuebleEssence] = useState("");
  const [filterTipoMuebleCatrice, setFilterTipoMuebleCatrice] = useState("");

  // selección (objetos para DataTable)
  const [selectedRows, setSelectedRows] = useState([]);

  // edición
  const [editTipoMueble, setEditTipoMueble] = useState(null);
  const [isSaving, setIsSaving] = useState(false);

  // ===== Toast helpers =====
  const showToast = ({ type = "info", summary, detail, life = 3500, content, sticky, className }) =>
    toast.current?.show({ severity: type, summary, detail, life, content, sticky, className });

  const showSuccess = (m) => showToast({ type: "success", summary: "Éxito", detail: m });
  const showInfo = (m) => showToast({ type: "info", summary: "Información", detail: m });
  const showWarn = (m) => showToast({ type: "warn", summary: "Advertencia", detail: m });
  const showError = (m) => showToast({ type: "error", summary: "Error", detail: m, life: 9000 });

  // ====== carga inicial ======
  const loadTipoMuebles = async () => {
    setLoading(true);
    setError("");
    try {
      const resp = await fetch(
        `/api-sellout/fybeca/tipo-mueble?codCliente=${encodeURIComponent(COD_CLIENTE_FIJO)}`
      );
      if (!resp.ok) throw new Error("Error al cargar tipos de mueble");
      const data = await resp.json();
      setTipoMuebles(Array.isArray(data) ? data : []);
      setSelectedRows([]);
    } catch (e) {
      setError(e.message);
      showError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadTipoMuebles();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ====== opciones Essence/Catrice ======
  const essenceOptions = useMemo(() => {
    const arr = Array.from(new Set((tipoMuebles || []).map((tm) => tm?.tipoMuebleEssence).filter(Boolean))).sort();
    return arr.map((x) => ({ label: x, value: x }));
  }, [tipoMuebles]);

  const catriceOptions = useMemo(() => {
    const arr = Array.from(new Set((tipoMuebles || []).map((tm) => tm?.tipoMuebleCatrice).filter(Boolean))).sort();
    return arr.map((x) => ({ label: x, value: x }));
  }, [tipoMuebles]);

  const safeLower = (v) => String(v ?? "").toLowerCase();

  // ====== lista visible con SOLO estos filtros ======
  const visibleTipoMuebles = useMemo(() => {
    return (tipoMuebles || []).filter((tm) => {
      const esCliente = (tm?.cliente?.codCliente || "").trim() === COD_CLIENTE_FIJO;
      if (!esCliente) return false;

      const matchEssence = !filterTipoMuebleEssence || tm?.tipoMuebleEssence === filterTipoMuebleEssence;
      const matchCatrice = !filterTipoMuebleCatrice || tm?.tipoMuebleCatrice === filterTipoMuebleCatrice;

      // ✅ búsqueda general por marca (si tu entidad tiene "marca" o viene dentro de producto)
      const marcaRow = tm?.marca ?? tm?.producto?.marca ?? "";
      const matchMarca = !filterMarca || safeLower(marcaRow).includes(safeLower(filterMarca));

      return matchEssence && matchCatrice && matchMarca;
    });
  }, [tipoMuebles, filterTipoMuebleEssence, filterTipoMuebleCatrice, filterMarca]);

  // ====== crear / actualizar ======
  const crearTipoMueble = async (tm) => {
    setIsSaving(true);
    try {
      tm.cliente = { ...(tm.cliente || {}), codCliente: COD_CLIENTE_FIJO };
      const resp = await fetch("/api-sellout/fybeca/tipo-mueble", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(tm),
      });
      if (!resp.ok) throw new Error("Error al crear tipo de mueble");

      showSuccess("Tipo de mueble creado correctamente");
      setEditTipoMueble(null);
      await loadTipoMuebles();
    } catch (e) {
      setError(e.message);
      showError(e.message);
    } finally {
      setIsSaving(false);
    }
  };

  const actualizarTipoMueble = async (tm) => {
    setIsSaving(true);
    try {
      tm.cliente = { ...(tm.cliente || {}), codCliente: COD_CLIENTE_FIJO };
      const resp = await fetch(`/api-sellout/fybeca/tipo-mueble/${tm.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(tm),
      });
      if (!resp.ok) throw new Error("Error al actualizar tipo de mueble");

      showSuccess("Tipo de mueble actualizado correctamente");
      setEditTipoMueble(null);
      await loadTipoMuebles();
    } catch (e) {
      setError(e.message);
      showError(e.message);
    } finally {
      setIsSaving(false);
    }
  };

  // ====== eliminación individual ======
  const eliminarTipoMueble = (id) => {
    confirmDialog({
      message: "¿Está seguro de eliminar este tipo de mueble?",
      header: "Confirmación de eliminación",
      icon: "pi pi-exclamation-triangle",
      acceptLabel: "Sí, eliminar",
      rejectLabel: "Cancelar",
      acceptClassName: "p-button-danger",
      closable: false,
      accept: async () => {
        setLoading(true);
        try {
          const resp = await fetch(`/api-sellout/fybeca/tipo-mueble/${id}`, { method: "DELETE" });
          if (!resp.ok) {
            const parsed = await parseDeleteResponse(resp);
            showDeletionOutcome(parsed, showSuccess, showWarn, showInfo);
            return;
          }
          setTipoMuebles((prev) => prev.filter((x) => x.id !== id));
          setSelectedRows((prev) => prev.filter((r) => r.id !== id));
          showSuccess("Tipo de mueble eliminado correctamente");
        } catch (e) {
          setError(e.message);
          showError(e.message);
        } finally {
          setLoading(false);
        }
      },
    });
  };

  // ====== eliminación masiva ======
  const eliminarTipoMueblesSeleccionados = () => {
    if (!selectedRows.length) return showInfo("No hay tipos de mueble seleccionados");

    const selectedIds = selectedRows.map((r) => r.id);

    confirmDialog({
      message: `¿Está seguro de eliminar ${selectedIds.length} tipo(s) de mueble?`,
      header: "Confirmación de eliminación",
      icon: "pi pi-exclamation-triangle",
      acceptLabel: "Sí, eliminar",
      rejectLabel: "Cancelar",
      acceptClassName: "p-button-danger",
      closable: false,
      accept: async () => {
        setLoading(true);
        try {
          const batchSize = 2000;
          let eliminadosTotal = [];
          let bloqueadosTotal = [];
          let bloqueadosInfoTotal = [];
          let messages = [];

          for (let i = 0; i < selectedIds.length; i += batchSize) {
            const batch = selectedIds.slice(i, i + batchSize);
            // eslint-disable-next-line no-await-in-loop
            const resp = await fetch("/api-sellout/fybeca/eliminar-varios-tipo-mueble", {
              method: "DELETE",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(batch),
            });

            // eslint-disable-next-line no-await-in-loop
            const parsed = await parseDeleteResponse(resp);

            eliminadosTotal = eliminadosTotal.concat(parsed.eliminados || []);
            bloqueadosTotal = bloqueadosTotal.concat(parsed.bloqueados || []);
            bloqueadosInfoTotal = bloqueadosInfoTotal.concat(parsed.bloqueadosInfo || []);
            if (parsed.message) messages.push(parsed.message);
          }

          const removeSet = new Set(eliminadosTotal);

          setTipoMuebles((prev) => prev.filter((x) => !removeSet.has(x.id)));
          setSelectedRows([]);

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
          setError(e.message);
          showError(e.message);
        } finally {
          setLoading(false);
        }
      },
    });
  };

  // ====== subir XLSX ======
  const subirArchivo = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setLoadingUpload(true);
    try {
      const fd = new FormData();
      fd.append("file", file);

      const resp = await fetch("/api-sellout/fybeca/template-tipo-muebles", { method: "POST", body: fd });
      if (!resp.ok) throw new Error("Error al subir archivo");

      const msg = await resp.text();
      showSuccess(msg || "Archivo subido correctamente");
      await loadTipoMuebles();
    } catch (e2) {
      setError(e2.message);
      showError(e2.message);
    } finally {
      setLoadingUpload(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  // ====== descargar reporte ======
  const descargarReporte = async () => {
    try {
      const resp = await fetch("/api-sellout/fybeca/reporte-tipo-mueble", { method: "GET" });
      if (!resp.ok) throw new Error("Error al descargar reporte");

      const cd = resp.headers.get("Content-Disposition");
      const filename = cd ? cd.split("filename=")[1]?.replace(/"/g, "") : "reporte_tipo_mueble.xlsx";

      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename || "reporte_tipo_mueble.xlsx";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);

      showSuccess("Reporte generado correctamente");
    } catch (e) {
      setError(e.message);
      showError(e.message);
    }
  };

  // ====== UI helpers ======
  const renderHeader = () => (
    <div className="deprati-table-header flex flex-wrap gap-2 align-items-center justify-content-between">
      <h4 className="deprati-title m-0">Tipos de Display Fybeca</h4>
      <span className="deprati-search p-input-icon-left">
        <i className="pi pi-search" />
        <InputText
          value={filterMarca}
          onChange={(e) => setFilterMarca(e.target.value || "")}
          placeholder="Buscar por marca..."
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
        onClick={eliminarTipoMueblesSeleccionados}
        disabled={!selectedRows.length}
      />
      <Button
        label="Nuevo"
        icon="pi pi-plus"
        className="p-button-primary p-button-raised"
        onClick={() =>
          setEditTipoMueble({
            cliente: { codCliente: COD_CLIENTE_FIJO, nombreCliente: "" },
            ciudad: "",
            codPdv: "",
            nombrePdv: "",
            tipoMuebleEssence: "",
            tipoMuebleCatrice: "",
          })
        }
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
          const url = encodeURI("/TEMPLATE DE TIPO DE MUEBLE.xlsx");
          const a = document.createElement("a");
          a.href = url;
          a.download = "TEMPLATE DE TIPO DE MUEBLE.xlsx";
          a.click();
        }}
      />
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
        onChange={subirArchivo}
      />
      <Button
        label="Reporte"
        icon="pi pi-file-excel"
        className="p-button-success p-button-raised"
        onClick={descargarReporte}
      />
    </div>
  );

  const actionTemplate = (row) => (
    <div className="deprati-row-actions flex gap-2 justify-content-center">
      <Button
        icon="pi pi-pencil"
        className="p-button-rounded p-button-outlined p-button-info"
        onClick={() => setEditTipoMueble({ ...row })}
        tooltip="Editar"
        aria-label="Editar"
      />
      <Button
        icon="pi pi-trash"
        className="p-button-rounded p-button-outlined p-button-danger"
        onClick={() => eliminarTipoMueble(row.id)}
        tooltip="Eliminar"
        aria-label="Eliminar"
      />
    </div>
  );

  return (
    <div className="deprati-layout-wrapper">
      <Toast ref={toast} position="top-right" className="toast-on-top" />
      <ConfirmDialog />

      {/* Overlay upload */}
      {loadingUpload && (
        <div className="fixed top-0 left-0 w-full h-full flex justify-content-center align-items-center bg-black-alpha-70 z-5">
          <div className="surface-card p-5 border-round shadow-2 text-center" style={{ minWidth: 360, backgroundColor: "rgba(0,0,0,0.85)" }}>
            <ProgressSpinner style={{ width: "60px", height: "60px" }} />
            <div className="mt-3" style={{ fontWeight: "bold", color: "white", fontSize: "1.2rem" }}>
              Subiendo archivo...
            </div>
          </div>
        </div>
      )}

      <div className="deprati-card card">
        <h1 className="deprati-main-title text-center text-primary my-4">Tipos de Display Fybeca</h1>

        <Toolbar className="deprati-toolbar mb-4" left={leftToolbarTemplate} right={rightToolbarTemplate} />

        {/* Filtros (solo Essence + Catrice + búsqueda marca) */}
        <Card className="deprati-filter-card mb-4">
          <h3 className="deprati-section-title text-primary mb-3">Filtros</h3>

          <div className="grid formgrid">
            <div className="flex flex-wrap gap-8 align-items-end">
              <div className="field">
                <label className="deprati-label font-bold block mb-2">Tipo Display Essence</label>
                <Dropdown
                  value={filterTipoMuebleEssence}
                  options={essenceOptions}
                  onChange={(e) => setFilterTipoMuebleEssence(e.value || "")}
                  placeholder="Todos"
                  className="deprati-dropdown w-16rem"
                  showClear
                />
              </div>

              <div className="field">
                <label className="deprati-label font-bold block mb-2">Tipo Display Catrice</label>
                <Dropdown
                  value={filterTipoMuebleCatrice}
                  options={catriceOptions}
                  onChange={(e) => setFilterTipoMuebleCatrice(e.value || "")}
                  placeholder="Todos"
                  className="deprati-dropdown w-16rem"
                  showClear
                />
              </div>

              <div className="field">
                <label className="deprati-label font-bold block mb-2">Marca (búsqueda)</label>
                <InputText
                  value={filterMarca}
                  onChange={(e) => setFilterMarca(e.target.value || "")}
                  placeholder="Ej: essence, catrice..."
                  className="deprati-search-input w-16rem"
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
                setFilterTipoMuebleEssence("");
                setFilterTipoMuebleCatrice("");
                setFilterMarca("");
                setSelectedRows([]);
                showInfo("Filtros limpiados");
              }}
            />
          </div>
        </Card>

        {/* Tabla */}
        <div className="card">
          <DataTable
            value={visibleTipoMuebles}
            dataKey="id"
            paginator
            rows={50}
            rowsPerPageOptions={[50, 100, 150, 200]}
            responsiveLayout="scroll"
            stripedRows
            showGridlines
            header={renderHeader}
            emptyMessage={error ? `Error: ${error}` : "No se encontraron registros con los filtros."}
            loading={loading}
            selection={selectedRows}
            onSelectionChange={(e) => {
              const value = e.value || [];
              if (value.length > 5000) {
                showWarn("Solo puede seleccionar un máximo de 5000 registros.");
                setSelectedRows(value.slice(0, 5000));
              } else {
                setSelectedRows(value);
              }
            }}
            className="p-datatable-sm"
            tableStyle={{ minWidth: "60rem" }}
          >
            <Column selectionMode="multiple" headerStyle={{ width: "3rem" }} />
            <Column field="cliente.codCliente" header="Código Cliente" sortable />
            <Column field="cliente.nombreCliente" header="Nombre Cliente" sortable />
            <Column field="ciudad" header="Ciudad" sortable />
            <Column field="codPdv" header="Código PDV" sortable />
            <Column field="nombrePdv" header="Nombre PDV" sortable />
            <Column field="tipoMuebleEssence" header="Tipo Display Essence" sortable />
            <Column field="tipoMuebleCatrice" header="Tipo Display Catrice" sortable />
            <Column body={actionTemplate} header="Acciones" exportable={false} style={{ width: "10rem" }} />
          </DataTable>
        </div>

        {/* Dialog edición */}
        <Dialog
          visible={editTipoMueble !== null}
          onHide={() => setEditTipoMueble(null)}
          header={editTipoMueble?.id ? "Editar Tipo de Display" : "Nuevo Tipo de Display"}
          className="deprati-edit-dialog p-fluid"
          style={{ width: "55vw", maxWidth: "1100px" }}
          modal
          dismissableMask
          footer={
            <div className="flex justify-content-end gap-2">
              <Button
                label="Cancelar"
                icon="pi pi-times"
                className="p-button-outlined p-button-secondary"
                onClick={() => setEditTipoMueble(null)}
                type="button"
              />
              <Button
                label={isSaving ? "Guardando..." : "Guardar"}
                icon={isSaving ? "pi pi-spin pi-spinner" : "pi pi-check"}
                className="p-button-primary"
                disabled={isSaving}
                onClick={() => {
                  if (!editTipoMueble) return;
                  if (editTipoMueble?.id) actualizarTipoMueble(editTipoMueble);
                  else crearTipoMueble(editTipoMueble);
                }}
                type="button"
              />
            </div>
          }
        >
          {editTipoMueble && (
            <div className="p-3">
              <div className="grid formgrid p-fluid">
                <div className="col-12 md:col-6">
                  <span className="p-float-label w-full">
                    <InputText
                      id="codCliente"
                      value={editTipoMueble?.cliente?.codCliente ?? COD_CLIENTE_FIJO}
                      onChange={(e) =>
                        setEditTipoMueble((prev) => ({
                          ...prev,
                          cliente: { ...(prev?.cliente || {}), codCliente: e.target.value },
                        }))
                      }
                    />
                    <label htmlFor="codCliente">Código Cliente</label>
                  </span>
                </div>

                <div className="col-12 md:col-6">
                  <span className="p-float-label w-full">
                    <InputText
                      id="nombreCliente"
                      value={editTipoMueble?.cliente?.nombreCliente ?? ""}
                      onChange={(e) =>
                        setEditTipoMueble((prev) => ({
                          ...prev,
                          cliente: { ...(prev?.cliente || {}), nombreCliente: e.target.value },
                        }))
                      }
                    />
                    <label htmlFor="nombreCliente">Nombre Cliente</label>
                  </span>
                </div>

                <div className="col-12 md:col-4 mt-3">
                  <span className="p-float-label w-full">
                    <InputText
                      id="ciudad"
                      value={editTipoMueble?.ciudad ?? ""}
                      onChange={(e) => setEditTipoMueble((p) => ({ ...p, ciudad: e.target.value }))}
                    />
                    <label htmlFor="ciudad">Ciudad</label>
                  </span>
                </div>

                <div className="col-12 md:col-4 mt-3">
                  <span className="p-float-label w-full">
                    <InputText
                      id="codPdv"
                      value={editTipoMueble?.codPdv ?? ""}
                      onChange={(e) => setEditTipoMueble((p) => ({ ...p, codPdv: e.target.value }))}
                    />
                    <label htmlFor="codPdv">Código PDV</label>
                  </span>
                </div>

                <div className="col-12 md:col-4 mt-3">
                  <span className="p-float-label w-full">
                    <InputText
                      id="nombrePdv"
                      value={editTipoMueble?.nombrePdv ?? ""}
                      onChange={(e) => setEditTipoMueble((p) => ({ ...p, nombrePdv: e.target.value }))}
                    />
                    <label htmlFor="nombrePdv">Nombre PDV</label>
                  </span>
                </div>

                <div className="col-12 md:col-6 mt-3">
                  <span className="p-float-label w-full">
                    <Dropdown
                      id="tipoMuebleEssence"
                      value={editTipoMueble?.tipoMuebleEssence ?? ""}
                      options={essenceOptions}
                      onChange={(e) => setEditTipoMueble((p) => ({ ...p, tipoMuebleEssence: e.value || "" }))}
                      placeholder="Seleccione..."
                      className="w-full"
                      showClear
                    />
                    <label htmlFor="tipoMuebleEssence">Tipo Display Essence</label>
                  </span>
                </div>

                <div className="col-12 md:col-6 mt-3">
                  <span className="p-float-label w-full">
                    <Dropdown
                      id="tipoMuebleCatrice"
                      value={editTipoMueble?.tipoMuebleCatrice ?? ""}
                      options={catriceOptions}
                      onChange={(e) => setEditTipoMueble((p) => ({ ...p, tipoMuebleCatrice: e.value || "" }))}
                      placeholder="Seleccione..."
                      className="w-full"
                      showClear
                    />
                    <label htmlFor="tipoMuebleCatrice">Tipo Display Catrice</label>
                  </span>
                </div>
              </div>
            </div>
          )}
        </Dialog>
      </div>
    </div>
  );
};

export default FybecaTipoMueble;
