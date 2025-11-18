import React, { useEffect, useMemo, useRef, useState } from "react";
import "./css/fybeca.css";
import "@fortawesome/fontawesome-free/css/all.min.css";
import { Toast } from "primereact/toast";
import { ConfirmDialog, confirmDialog } from "primereact/confirmdialog";
import { ProgressSpinner } from "primereact/progressspinner";

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

export function showDeletionOutcome({ eliminados, bloqueados, bloqueadosInfo, message }, showSuccess, showWarn, showInfo) {
  if (eliminados?.length) {
    showSuccess(`Eliminados: ${eliminados.length}`);
  }
  if (bloqueados?.length) {
    const detalle = (bloqueadosInfo && bloqueadosInfo.length)
      ? bloqueadosInfo.map((p) => `ID ${p.id} (PDV: ${p?.codPdv ?? "-"})`).join("; ")
      : `IDs: ${bloqueados.join(", ")}`;
    const motivo = /ventas asociadas/i.test(message)
      ? "Tiene ventas asociadas"
      : "Restricción de integridad referencial";
    showWarn(`No se pudieron eliminar ${bloqueados.length} registro(s). Motivo: ${motivo}. ${detalle}`);
  }
  if (!eliminados?.length && !bloqueados?.length) {
    showInfo(message || "Operación completada");
  }
}
// ======================================================================================

const COD_CLIENTE_FIJO = "MZCL-000014"; // Siempre filtrar por este codCliente

const FybecaTipoMueble = () => {
  const toast = useRef(null);

  const [tipoMuebles, setTipoMuebles] = useState([]);
  const [loading, setLoading] = useState(false);
  const [loadingUpload, setLoadingUpload] = useState(false);

  const [error, setError] = useState("");

  // ====== filtros ======
  const [filter, setFilter] = useState("");
  const [filterTipoMuebleEssence, setFilterTipoMuebleEssence] = useState("");
  const [filterTipoMuebleCatrice, setFilterTipoMuebleCatrice] = useState("");

  // ====== selección múltiple (IDs) ======
  const [selectedIds, setSelectedIds] = useState([]);

  const showToast = ({ type = "info", summary, detail, life = 3000 }) => {
    toast.current?.show({ severity: type, summary, detail, life });
  };
  const showSuccess = (m) => showToast({ type: "success", summary: "Éxito", detail: m });
  const showInfo = (m) => showToast({ type: "info", summary: "Información", detail: m });
  const showWarn = (m) => showToast({ type: "warn", summary: "Advertencia", detail: m });
  const showError = (m) => showToast({ type: "error", summary: "Error", detail: m });

  // ====== carga inicial ======
  const loadTipoMuebles = async () => {
    setLoading(true);
    setError("");
    try {
      const resp = await fetch(`/api-sellout/fybeca/tipo-mueble?codCliente=${encodeURIComponent(COD_CLIENTE_FIJO)}`);
      if (!resp.ok) throw new Error(`Error al cargar tipos de mueble`);
      const data = await resp.json();
      setTipoMuebles(Array.isArray(data) ? data : []);
      setSelectedIds([]);
    } catch (e) {
      setError(e.message);
      showError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadTipoMuebles();
  }, []);

  // ====== opciones para selects (derivadas de data) ======
  const essenceOptions = useMemo(
    () => Array.from(new Set(tipoMuebles.map((tm) => tm?.tipoMuebleEssence).filter(Boolean))).sort(),
    [tipoMuebles]
  );
  const catriceOptions = useMemo(
    () => Array.from(new Set(tipoMuebles.map((tm) => tm?.tipoMuebleCatrice).filter(Boolean))).sort(),
    [tipoMuebles]
  );

  // ====== lista visible = filtros + cliente ======
  const visibleTipoMuebles = useMemo(() => {
    const q = (filter || "").toLowerCase().trim();
    return (tipoMuebles || []).filter((tm) => {
      const esCliente = (tm?.cliente?.codCliente || "").trim() === COD_CLIENTE_FIJO;
      if (!esCliente) return false;
      const matchTexto = !q || [
        tm?.codPdv,
        tm?.nombrePdv,
        tm?.ciudad,
        tm?.cliente?.codCliente,
        tm?.cliente?.nombreCliente,
        tm?.tipoMuebleEssence,
        tm?.tipoMuebleCatrice,
      ]
        .map((v) => String(v ?? "").toLowerCase())
        .some((v) => v.includes(q));

      const matchEssence = !filterTipoMuebleEssence || tm?.tipoMuebleEssence === filterTipoMuebleEssence;
      const matchCatrice = !filterTipoMuebleCatrice || tm?.tipoMuebleCatrice === filterTipoMuebleCatrice;
      return matchTexto && matchEssence && matchCatrice;
    });
  }, [tipoMuebles, filter, filterTipoMuebleEssence, filterTipoMuebleCatrice]);

  // ====== selección estilo "seleccionar visibles" ======
  const allVisibleIds = useMemo(() => visibleTipoMuebles.map((tm) => tm.id), [visibleTipoMuebles]);
  const areAllVisibleSelected = allVisibleIds.length > 0 && allVisibleIds.every((id) => selectedIds.includes(id));

  const handleSelect = (id) => {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };
  const handleSelectAll = () => {
    if (areAllVisibleSelected) {
      setSelectedIds((prev) => prev.filter((id) => !allVisibleIds.includes(id)));
    } else {
      setSelectedIds((prev) => Array.from(new Set([...prev, ...allVisibleIds])));
    }
  };

  // ====== crear / actualizar ======
  const [editTipoMueble, setEditTipoMueble] = useState(null);

  const crearTipoMueble = async (tm) => {
    setLoading(true);
    try {
      tm.cliente = { ...(tm.cliente || {}), codCliente: COD_CLIENTE_FIJO };
      const resp = await fetch("/api-sellout/fybeca/tipo-mueble", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(tm),
      });
      if (!resp.ok) throw new Error(`Error al crear tipo de mueble`);
      showSuccess("Tipo de mueble creado correctamente");
      setEditTipoMueble(null);
      await loadTipoMuebles();
    } catch (e) {
      setError(e.message);
      showError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const actualizarTipoMueble = async (tm) => {
    setLoading(true);
    try {
      tm.cliente = { ...(tm.cliente || {}), codCliente: COD_CLIENTE_FIJO };
      const resp = await fetch(`/api-sellout/fybeca/tipo-mueble/${tm.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(tm),
      });
      if (!resp.ok) throw new Error(`Error al actualizar tipo de mueble`);
      showSuccess("Tipo de mueble actualizado correctamente");
      setEditTipoMueble(null);
      await loadTipoMuebles();
    } catch (e) {
      setError(e.message);
      showError(e.message);
    } finally {
      setLoading(false);
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
      accept: async () => {
        setLoading(true);
        try {
          const resp = await fetch(`/api-sellout/fybeca/tipo-mueble/${id}`, { method: "DELETE" });
          if (!resp.ok) {
            const parsed = await parseDeleteResponse(resp);
            showDeletionOutcome(parsed, showSuccess, showWarn, showInfo);
            return;
          }
          // eliminado OK
          setTipoMuebles((prev) => prev.filter((x) => x.id !== id));
          setSelectedIds((prev) => prev.filter((x) => x !== id));
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
    if (!selectedIds.length) {
      showInfo("No hay tipos de mueble seleccionados");
      return;
    }
    confirmDialog({
      message: `¿Está seguro de eliminar ${selectedIds.length} tipo(s) de mueble?`,
      header: "Confirmación de eliminación",
      icon: "pi pi-exclamation-triangle",
      acceptLabel: "Sí, eliminar",
      rejectLabel: "Cancelar",
      acceptClassName: "p-button-danger",
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
            const resp = await fetch("/api-sellout/fybeca/eliminar-varios-tipo-mueble", {
              method: "DELETE",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(batch),
            });

            const parsed = await parseDeleteResponse(resp);
            eliminadosTotal = eliminadosTotal.concat(parsed.eliminados || []);
            bloqueadosTotal = bloqueadosTotal.concat(parsed.bloqueados || []);
            bloqueadosInfoTotal = bloqueadosInfoTotal.concat(parsed.bloqueadosInfo || []);
            if (parsed.message) messages.push(parsed.message);
          }

          // actualizar UI
          const removeSet = new Set(eliminadosTotal);
          setTipoMuebles((prev) => prev.filter((x) => !removeSet.has(x.id)));
          setSelectedIds((prev) => prev.filter((id) => !removeSet.has(id)));

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
  const fileInputRef = useRef(null);
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
    } catch (e) {
      setError(e.message);
      showError(e.message);
    } finally {
      setLoadingUpload(false);
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

  // ====== UI ======
  return (
    <div className="container">
      <h1>Tipos de Mueble Fybeca</h1>
      <Toast ref={toast} />
      <ConfirmDialog />

      {/* overlay de subida */}
      {loadingUpload && (
        <div className="overlay">
          <div className="spinner-container">
            <ProgressSpinner style={{ width: "70px", height: "70px" }} strokeWidth="8" animationDuration="0.7s" />
            <p>Subiendo archivo...</p>
          </div>
        </div>
      )}

      {/* Gestión de archivos y reportes */}
      <div className="card-section">
        <h3>Gestión de Archivos y Reportes</h3>
        <div className="button-grid">
          <div className="button-item">
            <button onClick={descargarReporte} className="btn-general">
              <i className="fas fa-file-excel" /> Descargar Reporte
            </button>
          </div>
          <div className="button-item">
            <a href="/TEMPLATE DE TIPO DE MUEBLE.xlsx" download className="btn-general">
              <i className="fas fa-download" /> <span>Descargar Template</span>
              <div className="btn-hover-effect" />
            </a>
          </div>
          <div className="button-item">
            <label className="file-upload" onClick={() => fileInputRef.current?.click()}>
              <i className="fas fa-file-upload" /> Elegir Archivo
            </label>
            <input ref={fileInputRef} type="file" accept=".xlsx,.xls,.csv" onChange={subirArchivo} style={{ display: "none" }} />
          </div>
        </div>
      </div>

      {/* Filtros */}
      <div className="card-section">
        <h3>Filtros de Búsqueda</h3>
        <div className="filter-container">
          <div className="filter-group">
            <label htmlFor="filter">Búsqueda General:</label>
            <div className="search-input">
              <i className="fas fa-search search-icon" />
              <input id="filter" type="text" placeholder="Buscar en todos los campos" value={filter} onChange={(e) => setFilter(e.target.value)} />
            </div>
          </div>
          <div className="filter-group">
            <label htmlFor="filterTipoMuebleEssence">Tipo Display Essence:</label>
            <select id="filterTipoMuebleEssence" value={filterTipoMuebleEssence} onChange={(e) => setFilterTipoMuebleEssence(e.target.value)}>
              <option value="">Todos</option>
              {essenceOptions.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>
          <div className="filter-group">
            <label htmlFor="filterTipoMuebleCatrice">Tipo Mueble Catrice:</label>
            <select id="filterTipoMuebleCatrice" value={filterTipoMuebleCatrice} onChange={(e) => setFilterTipoMuebleCatrice(e.target.value)}>
              <option value="">Todos</option>
              {catriceOptions.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="filter-actions">
          <button className="btn-general" onClick={() => { /* filtros ya son reactivos */ }}>
            <i className="fas fa-filter" /> Aplicar Filtros
          </button>
          <button
            className="btn-general"
            onClick={() => {
              setFilter("");
              setFilterTipoMuebleEssence("");
              setFilterTipoMuebleCatrice("");
            }}
          >
            <i className="fas fa-times" /> Limpiar Filtros
          </button>
        </div>
      </div>

      {/* Acciones */}
      <div className="card-section">
        <div className="actions-header">
          <h3>Acciones</h3>
          {selectedIds.length > 0 && (
            <span className="selected-rows">
              <i className="fas fa-check-square" /> {selectedIds.length} filas seleccionadas
            </span>
          )}
        </div>
        <div className="actions-buttons">
          <button className={`btn-crud ${selectedIds.length === 0 ? "disabled" : ""}`} onClick={eliminarTipoMueblesSeleccionados} disabled={!selectedIds.length}>
            <i className="fas fa-trash-alt" /> Eliminar Seleccionados
          </button>
        </div>
      </div>

      {/* Tabla */}
      <div className="card-section table-section">
        <h3>Listado de Tipos de Mueble</h3>
        {loading ? (
          <div className="loading-container">
            <ProgressSpinner style={{ width: "50px", height: "50px" }} />
            <p className="loading">Cargando tipos de mueble...</p>
          </div>
        ) : visibleTipoMuebles.length === 0 ? (
          <div className="empty-state">
            <i className="fas fa-search fa-3x" />
            <p>No hay tipos de mueble disponibles con los filtros actuales.</p>
          </div>
        ) : (
          <div className="table-responsive">
            <table>
              <thead>
                <tr>
                  <th>
                    <input type="checkbox" checked={areAllVisibleSelected} onChange={handleSelectAll} />
                  </th>
                  <th>Código Cliente</th>
                  <th>Nombre Cliente</th>
                  <th>Ciudad</th>
                  <th>Código PDV</th>
                  <th>Nombre PDV</th>
                  <th>Tipo Display Essence</th>
                  <th>Tipo Mueble Display Catrice</th>
                  <th>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {visibleTipoMuebles.map((tm) => (
                  <tr key={tm.id}>
                    <td>
                      <input type="checkbox" checked={selectedIds.includes(tm.id)} onChange={() => handleSelect(tm.id)} />
                    </td>
                    <td>{tm?.cliente?.codCliente ?? "N/A"}</td>
                    <td>{tm?.cliente?.nombreCliente ?? "N/A"}</td>
                    <td>{tm?.ciudad ?? "N/A"}</td>
                    <td>{tm?.codPdv}</td>
                    <td>{tm?.nombrePdv}</td>
                    <td>{tm?.tipoMuebleEssence}</td>
                    <td>{tm?.tipoMuebleCatrice}</td>
                    <td className="action-buttons">
                      <button className="btn-crud" onClick={() => setEditTipoMueble(tm)} title="Editar">
                        <i className="fas fa-pencil-alt" />
                      </button>
                      <button className="btn-crud" onClick={() => eliminarTipoMueble(tm.id)} title="Eliminar">
                        <i className="fas fa-trash-alt" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Modal edición simple */}
      {editTipoMueble && (
        <div className="modal">
          <div className="modal-content">
            <h2>{editTipoMueble?.id ? "Editar Tipo de Mueble" : "Crear Tipo de Mueble"}</h2>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (editTipoMueble?.id) actualizarTipoMueble(editTipoMueble);
                else crearTipoMueble(editTipoMueble);
              }}
            >
              <label>Código Cliente:</label>
              <input
                type="text"
                value={editTipoMueble?.cliente?.codCliente ?? ""}
                onChange={(e) =>
                  setEditTipoMueble((prev) => ({
                    ...prev,
                    cliente: { ...(prev?.cliente || {}), codCliente: e.target.value },
                  }))
                }
              />

              <label>Nombre Cliente:</label>
              <input
                type="text"
                value={editTipoMueble?.cliente?.nombreCliente ?? ""}
                onChange={(e) =>
                  setEditTipoMueble((prev) => ({
                    ...prev,
                    cliente: { ...(prev?.cliente || {}), nombreCliente: e.target.value },
                  }))
                }
              />

              <label>Ciudad:</label>
              <input type="text" value={editTipoMueble?.ciudad ?? ""} onChange={(e) => setEditTipoMueble({ ...editTipoMueble, ciudad: e.target.value })} />

              <label>Código PDV:</label>
              <input type="text" value={editTipoMueble?.codPdv ?? ""} onChange={(e) => setEditTipoMueble({ ...editTipoMueble, codPdv: e.target.value })} />

              <label>Nombre PDV:</label>
              <input type="text" value={editTipoMueble?.nombrePdv ?? ""} onChange={(e) => setEditTipoMueble({ ...editTipoMueble, nombrePdv: e.target.value })} />

              <label>Tipo Mueble Essence:</label>
              <select value={editTipoMueble?.tipoMuebleEssence ?? ""} onChange={(e) => setEditTipoMueble({ ...editTipoMueble, tipoMuebleEssence: e.target.value })}>
                <option value="">Seleccione...</option>
                {essenceOptions.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>

              <label>Tipo Mueble Catrice:</label>
              <select value={editTipoMueble?.tipoMuebleCatrice ?? ""} onChange={(e) => setEditTipoMueble({ ...editTipoMueble, tipoMuebleCatrice: e.target.value })}>
                <option value="">Seleccione...</option>
                {catriceOptions.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>

              <div className="modal-actions">
                <button type="submit" className="btn-crud">
                  Guardar Cambios
                </button>
                <button type="button" className="btn-crud" onClick={() => setEditTipoMueble(null)}>
                  Cancelar
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default FybecaTipoMueble;
