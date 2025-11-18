import React, { useEffect, useRef, useState } from "react";
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
import { Toolbar } from "primereact/toolbar";
import { Divider } from "primereact/divider";
import { ConfirmDialog, confirmDialog } from "primereact/confirmdialog";
import { Dropdown } from "primereact/dropdown";

// ===== Helper para ordenar en cliente según "campo,dir" =====
function sortArray(arr, sortStr = "id,asc") {
  if (!Array.isArray(arr) || !arr.length || !sortStr) return arr;
  const [field, dirRaw] = sortStr.split(",");
  const dir = (dirRaw || "asc").toLowerCase() === "desc" ? -1 : 1;
  const copy = [...arr];
  copy.sort((a, b) => {
    const va = a?.[field];
    const vb = b?.[field];
    if (va == null && vb == null) return 0;
    if (va == null) return -1 * dir;
    if (vb == null) return 1 * dir;
    if (typeof va === "number" && typeof vb === "number") {
      return (va - vb) * dir;
    }
    return String(va).localeCompare(String(vb), undefined, { sensitivity: "base" }) * dir;
  });
  return copy;
}

const API_BASE = "/api/clientes/empresas";

const Cliente = () => {
  const toast = useRef(null);

  // Tabla
  const [clientes, setClientes] = useState([]);
  const [allClientes, setAllClientes] = useState([]); // fuente completa para filtros en cliente
  const [loading, setLoading] = useState(false);
  const [selectedRows, setSelectedRows] = useState([]);

  // Paginación/orden en cliente
  const [pageable, setPageable] = useState({
    size: 10,
    sort: "id,asc",
  });
  const [first, setFirst] = useState(0);

  // Búsqueda global (cliente)
  const [search, setSearch] = useState("");

  // Modal de crear/editar
  const [editVisible, setEditVisible] = useState(false);
  const [saving, setSaving] = useState(false);
  const [current, setCurrent] = useState(null);

  // Loader overlay
  const [overlay, setOverlay] = useState(false);

  // Toasters
  const showSuccess = (msg) => toast.current.show({ severity: "success", summary: "Éxito", detail: msg, life: 3000 });
  const showInfo = (msg) => toast.current.show({ severity: "info", summary: "Información", detail: msg, life: 3000 });
  const showWarn = (msg) => toast.current.show({ severity: "warn", summary: "Advertencia", detail: msg, life: 3000 });
  const showError = (msg) => toast.current.show({ severity: "error", summary: "Error", detail: msg, life: 4000 });

  // ---- Carga de datos (SIN paginación de backend) ----
  const loadClientes = async () => {
    setLoading(true);
    try {
      const res = await fetch(API_BASE); // GET /api/clientes/empresas
      if (!res.ok) throw new Error("No se pudo cargar clientes");
      const data = await res.json(); // List<Cliente>
      const sorted = sortArray(data, pageable.sort);
      setAllClientes(sorted);
      // aplicar filtro actual si hay búsqueda
      if (search.trim()) {
        const filtered = applyFilter(sorted, search);
        setClientes(filtered);
      } else {
        setClientes(sorted);
      }
      setFirst(0);
    } catch (e) {
      console.error(e);
      showError("Error al cargar clientes");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadClientes();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- Filtro en cliente ----
  const applyFilter = (list, q) => {
    const term = q.trim().toLowerCase();
    if (!term) return list;
    return list.filter((c) => {
      const cod = (c.codCliente || "").toLowerCase();
      const nom = (c.nombreCliente || "").toLowerCase();
      const ciu = (c.ciudad || "").toLowerCase();
      const prov = (c.codigoProveedor || "").toLowerCase();
      return cod.includes(term) || nom.includes(term) || ciu.includes(term) || prov.includes(term);
    });
  };

  const doSearch = () => {
    const filtered = applyFilter(allClientes, search);
    setClientes(filtered);
    setFirst(0);
  };

  // ---- Paginación en cliente ----
  const onPage = (e) => {
    setFirst(e.first);
    setPageable((p) => ({ ...p, size: e.rows }));
  };

  // ---- Crear / Editar ----
  const openCreate = () => {
    setCurrent({ codCliente: "", nombreCliente: "", ciudad: "", codigoProveedor: "" });
    setEditVisible(true);
  };

  const openEdit = async (row) => {
    try {
      const res = await fetch(`${API_BASE}/${row.id}`); // GET /empresas/{id}
      if (!res.ok) throw new Error("No se pudo obtener el cliente");
      const data = await res.json();
      setCurrent(data);
      setEditVisible(true);
    } catch (e) {
      console.error(e);
      showError("No se pudo abrir el cliente");
    }
  };

  const saveCliente = async (e) => {
    e?.preventDefault?.();
    if (!current) return;

    if (!current.codCliente?.trim()) return showWarn("codCliente es requerido");
    if (!current.nombreCliente?.trim()) return showWarn("nombreCliente es requerido");

    setSaving(true);
    try {
      if (current.id) {
        // Update
        const res = await fetch(`${API_BASE}/${current.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(current),
        });
        if (!res.ok) throw new Error("No se pudo actualizar el cliente");
        showSuccess("Cliente actualizado");
      } else {
        // Create
        const res = await fetch(API_BASE, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(current),
        });
        if (!res.ok) throw new Error("No se pudo crear el cliente");
        showSuccess("Cliente creado");
      }
      setEditVisible(false);
      setCurrent(null);
      await loadClientes();
    } catch (e) {
      console.error(e);
      showError(e.message || "Error al guardar");
    } finally {
      setSaving(false);
    }
  };

  // ---- Eliminar ----
  const deleteOne = (row) => {
    confirmDialog({
      message: `¿Eliminar el cliente ${row.nombreCliente || row.codCliente || row.id}?`,
      header: "Confirmación",
      icon: "pi pi-exclamation-triangle",
      acceptLabel: "Sí, eliminar",
      rejectLabel: "Cancelar",
      acceptClassName: "p-button-danger",
      accept: async () => {
        try {
          const res = await fetch(`${API_BASE}/${row.id}`, { method: "DELETE" }); // DELETE /empresas/{id}
          if (!res.ok) throw new Error("No se pudo eliminar");
          showInfo("Cliente eliminado");
          await loadClientes();
        } catch (e) {
          console.error(e);
          showError("Error al eliminar");
        }
      },
    });
  };

  const deleteSelected = () => {
    if (!selectedRows?.length) return;
    confirmDialog({
      message: `¿Eliminar ${selectedRows.length} cliente(s) seleccionados?`,
      header: "Confirmación",
      icon: "pi pi-exclamation-triangle",
      acceptLabel: "Sí, eliminar",
      rejectLabel: "Cancelar",
      acceptClassName: "p-button-danger",
      accept: async () => {
        setOverlay(true);
        try {
          // Tu controller no tiene endpoint de borrado masivo: hacemos varios DELETE
          const ids = selectedRows.map((r) => r.id);
          const results = await Promise.allSettled(
            ids.map((id) => fetch(`${API_BASE}/${id}`, { method: "DELETE" }))
          );
          const fails = results.filter((r) => r.status === "rejected" || (r.value && !r.value.ok)).length;
          if (fails === 0) {
            showSuccess("Clientes eliminados");
          } else if (fails === ids.length) {
            showError("No se pudo eliminar ninguno");
          } else {
            showWarn(`Algunos no se pudieron eliminar (${fails}/${ids.length})`);
          }
          setSelectedRows([]);
          await loadClientes();
        } catch (e) {
          console.error(e);
          showError("Error en eliminación");
        } finally {
          setOverlay(false);
        }
      },
    });
  };

  // ---- Buscar por código (cliente) ----
  const [codSearch, setCodSearch] = useState("");
  const findByCodigo = async () => {
    const code = codSearch.trim().toLowerCase();
    if (!code) return showWarn("Ingrese un código");
    // Filtro local exacto por codCliente (case-insensitive)
    const one = allClientes.find((c) => (c.codCliente || "").toLowerCase() === code);
    if (!one) {
      showInfo(`No se encontró el cliente con código ${codSearch}`);
      return;
    }
    setClientes([one]);
    setFirst(0);
    showInfo("Búsqueda por código aplicada");
  };

  // ---- Exportaciones (local) ----
  const exportToExcel = () => {
    if (!clientes.length) return showWarn("No hay datos para exportar.");
    const ws = XLSX.utils.json_to_sheet(
      clientes.map((c) => ({
        ID: c.id,
        "Código Cliente": c.codCliente,
        "Nombre Cliente": c.nombreCliente,
        Ciudad: c.ciudad,
        "Código Proveedor": c.codigoProveedor,
      }))
    );
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Clientes");
    XLSX.writeFile(wb, "clientes.xlsx");
    showSuccess(`Exportados ${clientes.length} registros`);
  };

  // ---- UI templates ----
  const header = (
    <div className="deprati-table-header flex flex-wrap gap-2 align-items-center justify-content-between w-full">
      <h4 className="m-0">Clientes</h4>

      <div className="flex gap-2 align-items-center">
        <span className="p-input-icon-left">
          <i className="pi pi-search" />
          <InputText
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && doSearch()}
            placeholder="Buscar por código, nombre, ciudad o proveedor..."
            className="deprati-search-input"
            style={{ minWidth: 320 }}
          />
        </span>
        <Button label="Buscar" icon="pi pi-search" onClick={doSearch} className="p-button-primary" />
      </div>
    </div>
  );

  const leftToolbarTemplate = () => (
    <div className="flex gap-2">
      <Button label="Nuevo Cliente" icon="pi pi-plus" onClick={openCreate} className="p-button-primary" />
      <Button
        label="Eliminar Seleccionados"
        icon="pi pi-trash"
        onClick={deleteSelected}
        className="p-button-danger p-button-outlined"
        disabled={!selectedRows.length}
      />
    </div>
  );

  const rightToolbarTemplate = () => (
    <div className="flex gap-2 align-items-center">
      <span className="p-inputgroup">
        <InputText
          placeholder="Código Cliente"
          value={codSearch}
          onChange={(e) => setCodSearch(e.target.value)}
          style={{ width: 200 }}
        />
        <Button icon="pi pi-search" onClick={findByCodigo} />
      </span>
      <Button label="Exportar Excel" icon="pi pi-file-excel" className="p-button-success" onClick={exportToExcel} />
    </div>
  );

  const rowActions = (row) => (
    <div className="flex gap-2 justify-content-center">
      <Button
        icon="pi pi-pencil"
        className="p-button-rounded p-button-outlined p-button-info"
        onClick={() => openEdit(row)}
        tooltip="Editar"
        tooltipOptions={{ position: "top" }}
      />
      <Button
        icon="pi pi-trash"
        className="p-button-rounded p-button-outlined p-button-danger"
        onClick={() => deleteOne(row)}
        tooltip="Eliminar"
        tooltipOptions={{ position: "top" }}
      />
    </div>
  );

  const sortOptions = [
    { label: "ID ↑", value: "id,asc" },
    { label: "ID ↓", value: "id,desc" },
    { label: "Código ↑", value: "codCliente,asc" },
    { label: "Código ↓", value: "codCliente,desc" },
    { label: "Nombre ↑", value: "nombreCliente,asc" },
    { label: "Nombre ↓", value: "nombreCliente,desc" },
    { label: "Ciudad ↑", value: "ciudad,asc" },
    { label: "Ciudad ↓", value: "ciudad,desc" },
    { label: "Proveedor ↑", value: "codigoProveedor,asc" },
    { label: "Proveedor ↓", value: "codigoProveedor,desc" },
  ];

  return (
    <div className="deprati-layout-wrapper">
      <Toast ref={toast} position="top-right" />
      <ConfirmDialog />

      {overlay && (
        <div className="deprati-loader-overlay">
          <ProgressSpinner className="deprati-spinner" />
          <div className="mt-3 text-white font-bold">Procesando...</div>
        </div>
      )}

      <div className="deprati-card card">
        <h1 className="text-center text-primary my-4">Mantenimiento de Clientes</h1>

        <Toolbar className="mb-4" left={leftToolbarTemplate} right={rightToolbarTemplate} />

        <div className="flex align-items-center gap-3 mb-3">
          <span className="font-medium">Orden:</span>
          <Dropdown
            value={pageable.sort}
            options={sortOptions}
            onChange={(e) => {
              const newSort = e.value;
              setPageable((p) => ({ ...p, sort: newSort }));
              const sorted = sortArray(search ? applyFilter(allClientes, search) : allClientes, newSort);
              setClientes(sorted);
              setFirst(0);
            }}
            placeholder="Seleccionar orden"
            style={{ width: 220 }}
          />
          <Divider layout="vertical" />
          <span className="font-medium">Tamaño página:</span>
          <Dropdown
            value={pageable.size}
            options={[10, 20, 50, 100].map((n) => ({ label: n, value: n }))}
            onChange={(e) => {
              setPageable((p) => ({ ...p, size: e.value }));
              setFirst(0);
            }}
            style={{ width: 120 }}
          />
        </div>

        <div className="card">
          <DataTable
            value={clientes}
            loading={loading}
            dataKey="id"
            header={header}
            paginator
            rows={pageable.size}
            first={first}
            onPage={onPage}
            sortMode="single"
            responsiveLayout="scroll"
            stripedRows
            showGridlines
            selection={selectedRows}
            onSelectionChange={(e) => setSelectedRows(e.value)}
            emptyMessage="No se encontraron registros"
          >
            <Column selectionMode="multiple" headerStyle={{ width: "3rem" }} headerCheckbox />
            <Column field="id" header="ID" sortable style={{ width: "8rem" }} />
            <Column field="codCliente" header="Código" sortable />
            <Column field="nombreCliente" header="Nombre" sortable />
            <Column field="ciudad" header="Ciudad" sortable />
            <Column field="codigoProveedor" header="Proveedor" sortable />
            <Column body={rowActions} header="Acciones" style={{ width: "9rem" }} />
          </DataTable>
        </div>
      </div>

      {/* Dialog Crear/Editar */}
      <Dialog
        visible={editVisible}
        onHide={() => setEditVisible(false)}
        header={current?.id ? "Editar Cliente" : "Nuevo Cliente"}
        className="p-fluid"
        style={{ width: "40rem", maxWidth: "95vw" }}
        modal
        closable={!saving}
      >
        <form onSubmit={saveCliente} className="p-3">
          <div className="field">
            <span className="p-float-label">
              <InputText
                id="codCliente"
                value={current?.codCliente || ""}
                onChange={(e) => setCurrent({ ...current, codCliente: e.target.value })}
                className={!current?.codCliente ? "p-invalid" : ""}
                disabled={!!current?.id}
              />
              <label htmlFor="codCliente">Código Cliente *</label>
            </span>
            {!current?.codCliente && <small className="p-error">Requerido</small>}
          </div>

          <div className="field">
            <span className="p-float-label">
              <InputText
                id="nombreCliente"
                value={current?.nombreCliente || ""}
                onChange={(e) => setCurrent({ ...current, nombreCliente: e.target.value })}
                className={!current?.nombreCliente ? "p-invalid" : ""}
              />
              <label htmlFor="nombreCliente">Nombre Cliente *</label>
            </span>
            {!current?.nombreCliente && <small className="p-error">Requerido</small>}
          </div>

          <div className="grid">
            <div className="col-12 md:col-6">
              <span className="p-float-label w-full">
                <InputText
                  id="ciudad"
                  value={current?.ciudad || ""}
                  onChange={(e) => setCurrent({ ...current, ciudad: e.target.value })}
                />
                <label htmlFor="ciudad">Ciudad</label>
              </span>
            </div>
            <div className="col-12 md:col-6">
              <span className="p-float-label w-full">
                <InputText
                  id="codigoProveedor"
                  value={current?.codigoProveedor || ""}
                  onChange={(e) => setCurrent({ ...current, codigoProveedor: e.target.value })}
                />
                <label htmlFor="codigoProveedor">Código Proveedor</label>
              </span>
            </div>
          </div>

          <Divider />

          <div className="flex justify-content-end gap-2">
            <Button
              type="button"
              label="Cancelar"
              icon="pi pi-times"
              className="p-button-outlined p-button-secondary"
              onClick={() => setEditVisible(false)}
              disabled={saving}
            />
            <Button
              type="submit"
              label={saving ? "Guardando..." : "Guardar"}
              icon={saving ? "pi pi-spin pi-spinner" : "pi pi-check"}
              disabled={saving}
              className="p-button-primary"
            />
          </div>
        </form>
      </Dialog>
    </div>
  );
};

export default Cliente;
