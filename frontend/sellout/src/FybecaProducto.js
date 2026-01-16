import React, { useEffect, useState } from "react";
import "./css/fybeca.css"; // Asegúrate de tener tu archivo CSS
import { ProgressSpinner } from 'primereact/progressspinner';
import { Paginator } from "primereact/paginator";

const FybecaProducto = () => {
  const [productos, setProductos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [productoEditar, setProductoEditar] = useState(null);
  const [showModal, setShowModal] = useState(false);
  const [filtros, setFiltros] = useState({
    nombre: '',
    codigoSap: '',
    descripcion: '',
    anio: '',
    mes: '',
    dia: '',
    marca: '',
    fechaDesde: '',
    fechaHasta: ''
  });
  const [paginatorState, setPaginatorState] = useState({ first: 0, rows: 50, totalRecords: 0 });

  // Función para cargar productos con filtros aplicados
  const loadProductos = async () => {
    setLoading(true);
    setError(null);
    try {
      const queryParams = new URLSearchParams(filtros).toString();
      const response = await fetch(`/api-sellout/fybeca/reportes-productos?${queryParams}`);
      if (!response.ok) {
        throw new Error(`Error al cargar productos: ${response.statusText}`);
      }
      const data = await response.json();
      setProductos(data);
      setPaginatorState((p) => ({ ...p, totalRecords: Array.isArray(data) ? data.length : 0, first: 0 }));
    } catch (error) {
      setError(error.message);
    } finally {
      setLoading(false);
    }
  };

  // Maneja cambios en los filtros
  const handleFilterChange = (e) => {
    const { name, value } = e.target;
    setFiltros((prev) => ({
      ...prev,
      [name]: value
    }));
  };

  // Maneja el envío del formulario de filtros
  const handleApplyFilters = (e) => {
    e.preventDefault();
    setLoading(true); // Activa el spinner antes de filtrar
    loadProductos();  // Recargar productos con los filtros aplicados
  };

  const handleEdit = (id) => {
    const producto = productos.find((p) => p.id === id);
    setProductoEditar(producto);
    setShowModal(true);
  };

  const handleCloseModal = () => {
    setShowModal(false);
    setProductoEditar(null);
  };

  const handleUpdateProducto = async (e) => {
    e.preventDefault();
    setLoading(true); // Activa el spinner mientras se actualiza el producto
    try {
      const response = await fetch(`/api-sellout/fybeca/productos/${productoEditar.id}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(productoEditar),
      });
      if (!response.ok) {
        throw new Error("Error al actualizar el producto");
      }
      await loadProductos(); // 🔄 Recargar lista de productos después de actualizar
      handleCloseModal();
    } catch (error) {
      setError(error.message); } finally {
        setLoading(false); // Desactiva el spinner después del proceso
      }
  };

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setProductoEditar((prev) => ({
      ...prev,
      [name]: value,
    }));
  };

  const handleDelete = async (id) => {
    if (window.confirm("¿Seguro que deseas eliminar este producto?")) {
      setLoading(true); // Activa el spinner antes de eliminar
      try {
        const response = await fetch(`/api-sellout/fybeca/productos/${id}`, {
          method: "DELETE",
        });
        if (!response.ok) {
          throw new Error("Error al eliminar el producto");
        }
        loadProductos();
      } catch (error) {
        setError(error.message);
      } finally {
        setLoading(false); // Desactiva el spinner después del proceso
      }
    }
  };

  useEffect(() => {
    loadProductos();
  }, [filtros]); // Recargar productos cuando los filtros cambian

  return (
    <div className="container">
      <h1>Fybeca - Productos</h1>
      {loading ? (
        // Mostrar el spinner mientras se cargan los productos
        <div style={{
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          height: "200px" // Ajusta la altura para centrar el spinner
        }}>
          <ProgressSpinner
            style={{ width: "50px", height: "50px" }}
            strokeWidth="6"
            fill="var(--surface-ground)"
            animationDuration="0.7s"
          />
        </div>
      ) : error ? (
        // Mostrar mensaje de error si hay un problema al cargar los productos
        <p className="error">Error: {error}</p>
      ) : (
        // Mostrar la lista de productos cuando se hayan cargado correctamente
        <>
          <h2>Lista de Productos</h2>

          {/* Filtros de productos */}
          <form onSubmit={handleApplyFilters}>
            <label>Nombre</label>
            <input
              type="text"
              name="nombre"
              value={filtros.nombre}
              onChange={handleFilterChange}
            />
            <label>Código SAP</label>
            <input
              type="text"
              name="codigoSap"
              value={filtros.codigoSap}
              onChange={handleFilterChange}
            />
            <label>Descripción</label>
            <input
              type="text"
              name="descripcion"
              value={filtros.descripcion}
              onChange={handleFilterChange}
            />
            <label>Año</label>
            <input
              type="number"
              name="anio"
              value={filtros.anio}
              onChange={handleFilterChange}
              min="1900"
              max="2100"
            />
            <label>Mes</label>
            <input
              type="number"
              name="mes"
              value={filtros.mes}
              onChange={handleFilterChange}
              min="1"
              max="12"
            />
            <label>Día</label>
            <input
              type="number"
              name="dia"
              value={filtros.dia}
              onChange={handleFilterChange}
              min="1"
              max="31"
            />
            <label>Marca</label>
            <input
              type="text"
              name="marca"
              value={filtros.marca}
              onChange={handleFilterChange}
            />
            <label>Fecha Desde</label>
            <input
              type="date"
              name="fechaDesde"
              value={filtros.fechaDesde}
              onChange={handleFilterChange}
            />
            <label>Fecha Hasta</label>
            <input
              type="date"
              name="fechaHasta"
              value={filtros.fechaHasta}
              onChange={handleFilterChange}
            />
            <button type="submit" className="btn-filter">Aplicar Filtros</button>
          </form>

          <div className="table-wrapper">
            <table>
              <thead>
                <tr>
                  <th>Nombre del Producto</th>
                  <th>Código SAP</th>
                  <th>Código Barra</th>
                  <th>Código PDV</th>
                  <th>Descripción</th>
                  <th>PDV</th>
                  <th>Stock en Dólares</th>
                  <th>Stock en Unidades</th>
                  <th>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {productos.slice(paginatorState.first, paginatorState.first + paginatorState.rows).map((producto) => (
                  <tr key={producto.id}>
                    <td>{producto.nombre_Producto}</td>
                    <td>{producto.codigo_Sap}</td>
                    <td>{producto.cod_Barra}</td>
                    <td>{producto.cod_Pdv}</td>
                    <td>{producto.descripcion}</td>
                    <td>{producto.pdv}</td>
                    <td>{producto.stock_Dolares}</td>
                    <td>{producto.stock_Unidades}</td>
                    <td>
                      <button onClick={() => handleEdit(producto.id)} className="btn-edit">
                        Editar
                      </button>
                      <button onClick={() => handleDelete(producto.id)} className="btn-delete">
                        Eliminar
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Paginator
            first={paginatorState.first}
            rows={paginatorState.rows}
            totalRecords={paginatorState.totalRecords}
            rowsPerPageOptions={[50, 100, 150, 200]}
            onPageChange={(e) => setPaginatorState((p) => ({ ...p, first: e.first, rows: e.rows }))}
            template="FirstPageLink PrevPageLink PageLinks NextPageLink LastPageLink RowsPerPageDropdown"
            className="mt-3"
          />

          {showModal && productoEditar && (
            <div className="modal">
              <div className="modal-content">
                <h2>Editar Producto</h2>
                <form onSubmit={handleUpdateProducto}>
                  <label>Nombre</label>
                  <input
                    type="text"
                    name="nombre_Producto"
                    value={productoEditar.nombre_Producto}
                    onChange={handleInputChange}
                  />
                  <label>Código SAP</label>
                  <input
                    type="text"
                    name="codigo_Sap"
                    value={productoEditar.codigo_Sap}
                    onChange={handleInputChange}
                  />
                  <label>Código Barra</label>
                  <input
                    type="text"
                    name="cod_Barra"
                    value={productoEditar.cod_Barra}
                    onChange={handleInputChange}
                  />
                  <label>Código PDV</label>
                  <input
                    type="text"
                    name="cod_Pdv"
                    value={productoEditar.cod_Pdv}
                    onChange={handleInputChange}
                  />
                  <label>Descripción</label>
                  <input
                    type="text"
                    name="descripcion"
                    value={productoEditar.descripcion}
                    onChange={handleInputChange}
                  />
                  <label>PDV</label>
                  <input
                    type="text"
                    name="pdv"
                    value={productoEditar.pdv}
                    onChange={handleInputChange}
                  />
                  <label>Stock en Dólares</label>
                  <input
                    type="number"
                    name="stock_Dolares"
                    value={productoEditar.stock_Dolares}
                    onChange={handleInputChange}
                  />
                  <label>Stock en Unidades</label>
                  <input
                    type="number"
                    name="stock_Unidades"
                    value={productoEditar.stock_Unidades}
                    onChange={handleInputChange}
                  />
                  <div className="modal-actions">
                    <button type="submit" className="btn-save">Guardar</button>
                    <button type="button" className="btn-close" onClick={handleCloseModal}>
                      Cerrar
                    </button>
                  </div>
                </form>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default FybecaProducto;
