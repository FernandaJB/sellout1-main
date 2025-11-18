import React, { useEffect, useState, useRef } from "react";
import "./css/deprati.css";
import "primereact/resources/themes/lara-light-indigo/theme.css";
import "primereact/resources/primereact.min.css";
import "primeicons/primeicons.css";
import "primeflex/primeflex.css";
import "@fortawesome/fontawesome-free/css/all.min.css";
import { Toast } from "primereact/toast";
import { ProgressSpinner } from "primereact/progressspinner";
import { DataTable } from 'primereact/datatable';
import { Column } from 'primereact/column';
import { Button } from 'primereact/button';
import { Dialog } from 'primereact/dialog';
import { InputText } from 'primereact/inputtext';
import { Dropdown } from 'primereact/dropdown';
import { FileUpload } from 'primereact/fileupload';
import { Card } from 'primereact/card';
import { Toolbar } from 'primereact/toolbar';
import { Divider } from 'primereact/divider';
import { ConfirmDialog, confirmDialog } from 'primereact/confirmdialog';
import { Message } from 'primereact/message';
import { Paginator } from 'primereact/paginator';

const DepratiTipoMueble = () => {
  // Referencias para los mensajes toast
  const toast = useRef(null);
  const fileInputRef = useRef(null);
  
  // Estados existentes
  const [tipoMuebles, setTipoMuebles] = useState([]);
  const [loading, setLoading] = useState(false);
  const [selectedIds, setSelectedIds] = useState([]); 
  const [error, setError] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [editTipoMueble, setEditTipoMueble] = useState(null);
  const [filter, setFilter] = useState("");
  const [filteredTipoMuebles, setFilteredTipoMuebles] = useState([]);
  const [filterTipoMuebleEssence, setFilterTipoMuebleEssence] = useState("");
  const [loadingUpload, setLoadingUpload] = useState(false);
  const [globalFilter, setGlobalFilter] = useState('');
  const [filterMarca, setFilterMarca] = useState("");

  // Configuración de paginación
  const [paginatorState, setPaginatorState] = useState({
    first: 0,
    rows: 10,
    page: 0,
    totalRecords: 0
  });

  // Función para cargar los tipos de mueble desde la API
  const loadTipoMuebles = async () => {
     setLoading(true);
      setError("");
      try {
        const response = await fetch("/api-sellout/deprati/tipo-mueble?codCliente=MZCL-000009");
        if (!response.ok) throw new Error(`Error al cargar tipos de mueble: ${response.statusText}`);

        const data = await response.json();
        setTipoMuebles(data);
        setFilteredTipoMuebles(data);
        setPaginatorState(prevState => ({
          ...prevState,
          totalRecords: data.length
        }));
      } catch (error) {
        setError(error.message);
        showError(error.message);
      } finally {
        setLoading(false);
      }
    };
  // Cargar los tipos de mueble al montar el componente
  useEffect(() => {
    loadTipoMuebles();
  }, []);

  // Actualizar el total de registros cuando cambian los datos filtrados
  useEffect(() => {
    setPaginatorState(prevState => ({
      ...prevState,
      totalRecords: filteredTipoMuebles.length,
      first: 0,
      page: 0
    }));
  }, [filteredTipoMuebles]);

  // Manejador para cambios en la paginación
  const onPageChange = (event) => {
    setPaginatorState(event);
  };

  /**
   * Muestra mensaje de éxito
   */
  const showSuccess = (msg) => {
    toast.current.show({
      severity: 'success', 
      summary: 'Éxito', 
      detail: msg, 
      life: 3000,
      className: 'deprati-toast deprati-toast-success'
    });
  };

  /**
   * Muestra mensaje informativo
   */
  const showInfo = (msg) => {
    toast.current.show({
      severity: 'info', 
      summary: 'Información', 
      detail: msg, 
      life: 3000,
      className: 'deprati-toast deprati-toast-info'
    });
  };

  /**
   * Muestra mensaje de advertencia
   */
  const showWarn = (msg) => {
    toast.current.show({
      severity: 'warning', 
      summary: 'Advertencia', 
      detail: msg, 
      life: 3000,
      className: 'deprati-toast deprati-toast-warning'
    });
  };

  /**
   * Muestra mensaje de error
   */
  const showError = (msg) => {
    toast.current.show({
      severity: 'error', 
      summary: 'Error', 
      detail: msg, 
      life: 3000,
      className: 'deprati-toast deprati-toast-error'
    });
  };

  // Función para crear un nuevo tipo de mueble
  const crearTipoMueble = async (tipoMueble) => {
    try {
      const response = await fetch("/api-sellout/deprati/tipo-mueble", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(tipoMueble),
      });
  
      if (!response.ok) throw new Error(`Error al crear tipo de mueble: ${response.statusText}`);
  
      showSuccess('Tipo de mueble creado correctamente');
      setEditTipoMueble(null);
      await loadTipoMuebles();
    } catch (error) {
      showError(error.message);
    }
  };

  // Función para actualizar un tipo de mueble
  const actualizarTipoMueble = async (tipoMueble) => {
    setLoading(true);
    try {
      const response = await fetch(`/api-sellout/deprati/tipo-mueble/${tipoMueble.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(tipoMueble),
      });

      if (!response.ok) throw new Error(`Error al actualizar tipo de mueble: ${response.statusText}`);

      showSuccess('Tipo de mueble actualizado correctamente');
      setEditTipoMueble(null);
      await loadTipoMuebles();
    } catch (error) {
      showError(error.message);
    } finally {
      setLoading(false);
    }
  };

  // Función para eliminar los tipos de muebles seleccionados
  const eliminarTipoMueblesSeleccionados = () => {
    if (selectedIds.length === 0) {
      showInfo('No hay tipos de muebles seleccionados para eliminar');
      return;
    }
    
    confirmDialog({
      message: `¿Está seguro de eliminar ${selectedIds.length} tipo(s) de mueble?`,
      header: 'Confirmación de eliminación',
      icon: 'pi pi-exclamation-triangle',
      acceptLabel: 'Sí, eliminar',
      rejectLabel: 'No, cancelar',
      acceptClassName: 'p-button-danger',
      accept: async () => {
        setLoading(true);
        
        const batchSize = 2000;
        const batches = [];
        for (let i = 0; i < selectedIds.length; i += batchSize) {
          batches.push(selectedIds.slice(i, i + batchSize));
        }
        
        try {
          for (const batch of batches) {
            const response = await fetch("/api-sellout/deprati/eliminar-varios-tipo-mueble", {
              method: "DELETE",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(batch),
            });
            
            if (!response.ok) throw new Error(`Error al eliminar: ${response.statusText}`);
          }
          
          showSuccess('Tipos de muebles eliminados correctamente');
          await loadTipoMuebles();
          setSelectedIds([]);
        } catch (error) {
          showError(error.message);
        } finally {
          setLoading(false);
        }
      }
    });
  };

  // Función para eliminar un tipo de mueble
  const eliminarTipoMueble = (id) => {
    confirmDialog({
      message: '¿Está seguro de eliminar este tipo de mueble?',
      header: 'Confirmación de eliminación',
      icon: 'pi pi-exclamation-triangle',
      acceptLabel: 'Sí, eliminar',
      rejectLabel: 'No, cancelar',
      acceptClassName: 'p-button-danger',
      accept: async () => {
        try {
          const response = await fetch(`/api-sellout/deprati/tipo-mueble/${id}`, {
            method: "DELETE",
          });

          if (!response.ok) throw new Error(`Error al eliminar tipo de mueble: ${response.statusText}`);

          showSuccess('Tipo de mueble eliminado correctamente');
          await loadTipoMuebles();
        } catch (error) {
          showError(error.message);
        }
      }
    });
  };

  // Función para subir un archivo XLSX
  const subirArchivo = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    setLoadingUpload(true);

    const formData = new FormData();
    formData.append("file", file);

    try {
      const response = await fetch("/api-sellout/deprati/template-tipo-muebles", {
        method: "POST",
        body: formData,
      });

      if (!response.ok) throw new Error(`Error al subir archivo: ${response.statusText}`);

      showSuccess('Archivo subido correctamente');
      await loadTipoMuebles();
    } catch (error) {
      showError(error.message);
    } finally {
      setLoadingUpload(false);
    }
  };

  // Función para manejar el cambio en el campo de entrada del filtro
  const handleFilterChange = (e) => {
    setFilter(e.target.value);
  };

  // Función para aplicar el filtro
  const applyFilter = () => {
    const filtered = tipoMuebles.filter((tipoMueble) => {
      const searchTerm = filter.toLowerCase();
      return (
        (filter === "" || 
         (tipoMueble.codPdv && tipoMueble.codPdv.toLowerCase().includes(searchTerm)) ||
         (tipoMueble.nombrePdv && tipoMueble.nombrePdv.toLowerCase().includes(searchTerm)) ||
         (tipoMueble.ciudad && tipoMueble.ciudad.toLowerCase().includes(searchTerm)) ||
         (tipoMueble.cliente && tipoMueble.cliente.codCliente && 
          tipoMueble.cliente.codCliente.toLowerCase().includes(searchTerm)) ||
         (tipoMueble.cliente && tipoMueble.cliente.nombreCliente && 
          tipoMueble.cliente.nombreCliente.toLowerCase().includes(searchTerm))
        ) &&
        (filterTipoMuebleEssence === "" || tipoMueble.tipoMuebleEssence === filterTipoMuebleEssence) &&
        (filterMarca === "" || tipoMueble.marca === filterMarca)
      );
    });
  
    setFilteredTipoMuebles(filtered);
  };

  // Función para limpiar los filtros
  const clearFilters = () => {
    setFilter("");
    setFilterTipoMuebleEssence("");
    setGlobalFilter("");
    setFilterMarca("");
    setFilteredTipoMuebles(tipoMuebles);
  };

  // Función para manejar la selección de una fila
  const handleSelect = (id) => {
    setSelectedIds((prevSelectedIds) => {
      if (prevSelectedIds.includes(id)) {
        return prevSelectedIds.filter((selectedId) => selectedId !== id);
      } else {
        return [...prevSelectedIds, id];
      }
    });
  };

  // Función para manejar la selección/deselección de todas las filas
  const handleSelectAll = () => {
    if (selectedIds.length === filteredTipoMuebles.length) {
      setSelectedIds([]);
    } else {
      setSelectedIds(filteredTipoMuebles.map((tm) => tm.id));
    }
  };

  // Función para descargar el reporte
  const descargarReporte = async () => {
    try {
      const response = await fetch("/api-sellout/deprati/reporte-tipo-mueble", {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
        },
      });
  
      if (!response.ok) {
        throw new Error(`Error al descargar reporte: ${response.statusText}`);
      }
  
      const contentDisposition = response.headers.get("Content-Disposition");
      const fileName = contentDisposition
        ? contentDisposition.split("filename=")[1].replace(/"/g, "")
        : "reporte_tipo_mueble.xlsx";
  
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
      
      showSuccess('El reporte se ha descargado correctamente');
    } catch (error) {
      console.error(`Error al descargar el reporte: ${error.message}`);
      showError(`Error al descargar el reporte: ${error.message}`);
    }
  };

  // Función para renderizar las acciones en cada fila
  const actionBodyTemplate = (rowData) => {
    return (
      <div className="flex gap-2 justify-content-center">
        <Button 
          icon="pi pi-pencil" 
          className="p-button-rounded p-button-success p-button-outlined" 
          onClick={() => setEditTipoMueble(rowData)} 
          tooltip="Editar"
        />
        <Button 
          icon="pi pi-trash" 
          className="p-button-rounded p-button-danger p-button-outlined" 
          onClick={() => eliminarTipoMueble(rowData.id)} 
          tooltip="Eliminar"
        />
      </div>
    );
  };

  // Función para renderizar la columna de selección
  const selectionBodyTemplate = (rowData) => {
    return (
      <div className="flex justify-content-center">
        <input
          type="checkbox"
          checked={selectedIds.includes(rowData.id)}
          onChange={() => handleSelect(rowData.id)}
          className="p-checkbox"
        />
      </div>
    );
  };

  // Función para renderizar el encabezado de selección
  const selectionHeaderTemplate = () => {
    return (
      <div className="flex justify-content-center">
        <input
          type="checkbox"
          checked={selectedIds.length === filteredTipoMuebles.length && filteredTipoMuebles.length > 0}
          onChange={() => handleSelectAll()}
          className="p-checkbox"
        />
      </div>
    );
  };

  // Renderizado del componente
  return (
    <div className="deprati-container">
      <Toast ref={toast} />
      <ConfirmDialog />
      
      <div className="grid">
        <div className="col-12">
          <div className="card">
            <h1 className="text-center mb-4">Tipos de Mueble Deprati</h1>
            
            {/* Toolbar con acciones principales */}
            <Toolbar className="mb-4" 
              left={
                <div className="flex flex-wrap gap-2">
                  <Button 
                    label="Eliminar Seleccionados" 
                    icon="pi pi-trash" 
                    className="p-button-danger" 
                    onClick={eliminarTipoMueblesSeleccionados} 
                    disabled={selectedIds.length === 0}
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
                    accept=".xlsx" 
                    onChange={subirArchivo} 
                    ref={fileInputRef} 
                    style={{ display: "none" }} 
                  />
                  <Button 
                    label="Descargar Template" 
                    icon="pi pi-download" 
                    className="p-button-info" 
                    onClick={() => window.location.href = "/TEMPLATE DE TIPO DE MUEBLE.xlsx"}
                  />
                  <Button 
                    label="Generar Reporte" 
                    icon="pi pi-file-excel" 
                    className="p-button-success" 
                    onClick={descargarReporte}
                  />
                </div>
              }
            />
            
            {/* Filtros */}
            <Card className="mb-4" title="Filtros de Búsqueda">
              <div className="grid">
                <div className="col-12 md:col-6 lg:col-4">
                  <div className="p-inputgroup">
                    <span className="p-inputgroup-addon">
                      <i className="pi pi-search"></i>
                    </span>
                    <InputText 
                      placeholder="Buscar por código, nombre..." 
                      value={filter} 
                      onChange={handleFilterChange}
                      className="deprati-input"
                      style={{ color: '#000000', fontWeight: '600' }}
                    />
                  </div>
                </div>
                <div className="col-12 md:col-6 lg:col-3">
                  <div className="p-inputgroup">
                    <span className="p-inputgroup-addon">
                      <i className="pi pi-tag"></i>
                    </span>
                    <Dropdown 
                      value={filterTipoMuebleEssence} 
                      options={Array.from(new Set(tipoMuebles.map((tm) => tm.tipoMuebleEssence)))
                        .filter(Boolean)
                        .map(tipo => ({ label: tipo, value: tipo }))} 
                      onChange={(e) => setFilterTipoMuebleEssence(e.value)} 
                      placeholder="Seleccionar Tipo Mueble Essence" 
                      className="w-full"
                    />
                  </div>
                </div>
                <div className="col-12 md:col-6 lg:col-3">
                  <div className="p-inputgroup">
                    <span className="p-inputgroup-addon">
                      <i className="pi pi-tag"></i>
                    </span>
                    <Dropdown 
                      value={filterMarca} 
                      options={Array.from(new Set(tipoMuebles.map((tm) => tm.marca)))
                        .filter(Boolean)
                        .map(marca => ({ label: marca, value: marca }))} 
                      onChange={(e) => setFilterMarca(e.value)} 
                      placeholder="Seleccionar Marca" 
                      className="w-full"
                    />
                  </div>
                </div>
                <div className="col-12 md:col-6 lg:col-2 flex justify-content-end">
                  <Button 
                    label="Aplicar Filtros" 
                    icon="pi pi-filter" 
                    className="p-button-outlined mr-2" 
                    onClick={applyFilter}
                  />
                  <Button 
                    label="Limpiar Filtros" 
                    icon="pi pi-times" 
                    className="p-button-outlined p-button-danger" 
                    onClick={clearFilters}
                  />
                </div>
              </div>
            </Card>
            
            {/* DataTable */}
            <DataTable 
              value={filteredTipoMuebles.slice(paginatorState.first, paginatorState.first + paginatorState.rows)} 
              loading={loading}
              responsiveLayout="scroll"
              emptyMessage="No hay tipos de mueble disponibles."
              className="p-datatable-sm"
              showGridlines
              stripedRows
              paginator={false}
              globalFilter={globalFilter}
              header={
                <div className="flex justify-content-between align-items-center">
                  <h5 className="m-0">Gestión de Tipos de Mueble</h5>
                  <span className="p-input-icon-left">
                    <i className="pi pi-search" />
                    <InputText 
                      value={globalFilter} 
                      onChange={(e) => setGlobalFilter(e.target.value)} 
                      placeholder="Buscar..." 
                    />
                  </span>
                </div>
              }
            >
              <Column 
                body={selectionBodyTemplate} 
                header={selectionHeaderTemplate} 
                style={{ width: '3em' }}
              />
              <Column field="cliente.codCliente" header="Código Cliente" sortable 
                body={(rowData) => rowData.cliente ? rowData.cliente.codCliente : "N/A"}
              />
              <Column field="cliente.nombreCliente" header="Nombre Cliente" sortable
                body={(rowData) => rowData.cliente ? rowData.cliente.nombreCliente : "N/A"}
              />
              <Column field="ciudad" header="Ciudad" sortable />
              <Column field="codPdv" header="Código PDV" sortable />
              <Column field="nombrePdv" header="Nombre PDV" sortable />
              <Column field="tipoMuebleEssence" header="Tipo Mueble Essence" sortable />
              <Column field="marca" header="Marca" sortable />
              <Column body={actionBodyTemplate} header="Acciones" style={{ width: '8em' }} />
            </DataTable>
            
            {/* Paginador */}
            <Paginator 
              first={paginatorState.first} 
              rows={paginatorState.rows} 
              totalRecords={paginatorState.totalRecords} 
              rowsPerPageOptions={[5, 10, 20, 50]} 
              onPageChange={onPageChange}
              template="FirstPageLink PrevPageLink PageLinks NextPageLink LastPageLink RowsPerPageDropdown"
              className="mt-3"
            />
          </div>
        </div>
      </div>
      
      {/* Spinner de carga global */}
      {loadingUpload && (
        <div className="fixed top-0 left-0 w-full h-full flex justify-content-center align-items-center bg-black-alpha-60 z-5">
          <div className="surface-card p-5 border-round shadow-2 text-center">
            <ProgressSpinner style={{ width: '50px', height: '50px' }} />
            <div className="mt-3">Procesando archivo...</div>
          </div>
        </div>
      )}
      
      {/* Modal de edición */}
      <Dialog 
        visible={!!editTipoMueble} 
        style={{ width: '50vw' }} 
        header={editTipoMueble?.id ? "Editar Tipo de Mueble" : "Crear Tipo de Mueble"} 
        modal 
        className="p-fluid deprati-edit-dialog" 
        footer={
          <div className="flex justify-content-end gap-2">
            <Button 
              label="Cancelar" 
              icon="pi pi-times" 
              className="p-button-text p-button-secondary" 
              onClick={() => setEditTipoMueble(null)} 
            />
            <Button 
              label="Guardar" 
              icon="pi pi-check" 
              className="p-button-text p-button-primary" 
              onClick={() => {
                if (editTipoMueble.id) {
                  actualizarTipoMueble(editTipoMueble);
                } else {
                  crearTipoMueble(editTipoMueble);
                }
              }} 
            />
          </div>
        } 
        onHide={() => setEditTipoMueble(null)}
      >
        {editTipoMueble && (
          <div className="grid p-fluid deprati-form">
            <div className="col-12 md:col-6">
              <div className="field">
                <label htmlFor="codCliente" className="deprati-label font-bold block mb-2">Código Cliente</label>
                <InputText 
                  id="codCliente" 
                  className="deprati-input"
                  value={editTipoMueble.cliente ? editTipoMueble.cliente.codCliente : ""} 
                  onChange={(e) => setEditTipoMueble({ 
                    ...editTipoMueble, 
                    cliente: { 
                      ...editTipoMueble.cliente, 
                      codCliente: e.target.value 
                    } 
                  })} 
                />
              </div>
            </div>
            
            <div className="col-12 md:col-6">
              <div className="field">
                <label htmlFor="nombreCliente" className="deprati-label font-bold block mb-2">Nombre Cliente</label>
                <InputText 
                  id="nombreCliente" 
                  className="deprati-input"
                  value={editTipoMueble.cliente ? editTipoMueble.cliente.nombreCliente : ""} 
                  onChange={(e) => setEditTipoMueble({ 
                    ...editTipoMueble, 
                    cliente: { 
                      ...editTipoMueble.cliente, 
                      nombreCliente: e.target.value 
                    } 
                  })} 
                />
              </div>
            </div>
            
            <div className="col-12 md:col-6">
              <div className="field">
                <label htmlFor="ciudad" className="deprati-label font-bold block mb-2">Ciudad</label>
                <InputText 
                  id="ciudad" 
                  className="deprati-input"
                  value={editTipoMueble.ciudad || ""} 
                  onChange={(e) => setEditTipoMueble({ ...editTipoMueble, ciudad: e.target.value })} 
                />
              </div>
            </div>
            
            <div className="col-12 md:col-6">
              <div className="field">
                <label htmlFor="codPdv" className="deprati-label font-bold block mb-2">Código PDV</label>
                <InputText 
                  id="codPdv" 
                  className="deprati-input"
                  value={editTipoMueble.codPdv || ""} 
                  onChange={(e) => setEditTipoMueble({ ...editTipoMueble, codPdv: e.target.value })} 
                />
              </div>
            </div>
            
            <div className="col-12 md:col-6">
              <div className="field">
                <label htmlFor="nombrePdv" className="deprati-label font-bold block mb-2">Nombre PDV</label>
                <InputText 
                  id="nombrePdv" 
                  className="deprati-input"
                  value={editTipoMueble.nombrePdv || ""} 
                  onChange={(e) => setEditTipoMueble({ ...editTipoMueble, nombrePdv: e.target.value })} 
                />
              </div>
            </div>
            <div className="col-12 md:col-6">
              <div className="field">
                <label htmlFor="marca" className="deprati-label font-bold block mb-2">Marca</label>
                <InputText 
                  id="marca" 
                  className="deprati-input"
                  value={editTipoMueble.marca || ""} 
                  onChange={(e) => setEditTipoMueble({ ...editTipoMueble, marca: e.target.value })} 
                />
              </div>
            </div>
            <div className="col-12 md:col-6">
              <div className="field">
                <label htmlFor="tipoMuebleEssence" className="deprati-label font-bold block mb-2">Tipo Mueble Essence</label>
                <Dropdown 
                  id="tipoMuebleEssence" 
                  className="deprati-dropdown"
                  value={editTipoMueble.tipoMuebleEssence || ""} 
                  options={Array.from(new Set(tipoMuebles.map((tm) => tm.tipoMuebleEssence)))
                    .filter(Boolean)
                    .map(tipo => ({ label: tipo, value: tipo }))} 
                  onChange={(e) => setEditTipoMueble({ ...editTipoMueble, tipoMuebleEssence: e.value })} 
                  placeholder="Seleccione un tipo" 
                />
              </div>
            </div>
          </div>
        )}
      </Dialog>
    </div>
  );
};

export default DepratiTipoMueble;
