import React, { useEffect, useState } from "react";
import "./css/deprati.css";
import "./css/fybeca-deprati-compatibility.css";
import { Paginator } from "primereact/paginator";
const API_URL = "/api-sellout/fybeca/cliente";

const FybecaMantenimientoCliente = () => {
  const [clientes, setClientes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [clienteEditar, setClienteEditar] = useState(null);
  const [showModal, setShowModal] = useState(false);
  const [paginatorState, setPaginatorState] = useState({ first: 0, rows: 50, totalRecords: 0 });

  useEffect(() => {
    const loadClientes = async () => {
      try {
        const response = await fetch(API_URL);
        if (!response.ok) throw new Error("Error al cargar clientes");
        const data = await response.json();
        setClientes(data);
        setPaginatorState((p) => ({ ...p, totalRecords: Array.isArray(data) ? data.length : 0, first: 0 }));
      } catch (error) {
        setError(error.message);
      } finally {
        setLoading(false);
      }
    };
    loadClientes();
  }, []);

  const handleEdit = (id) => {
    setClienteEditar(clientes.find((c) => c.id === id));
    setShowModal(true);
  };

  const handleCloseModal = () => {
    setShowModal(false);
    setClienteEditar(null);
  };

  const handleUpdateCliente = async (e) => {
    e.preventDefault();
    try {
      await fetch(`${API_URL}/${clienteEditar.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(clienteEditar),
      });
      setShowModal(false);
    } catch (error) {
      setError(error.message);
    }
  };

  const handleInputChange = (e) => {
    setClienteEditar((prev) => ({ ...prev, [e.target.name]: e.target.value }));
  };

  return (
    <div className="container">
      <h1>Fybeca - Mantenimiento Clientes</h1>
      {loading ? (
        <p className="loading">Cargando clientes...</p>
      ) : error ? (
        <p className="error">Error: {error}</p>
      ) : (
        <>
          <h2>Lista de Mantenimiento Clientes</h2>
          <div className="table-wrapper">
            <table>
              <thead>
                <tr>
                  <th>Cliente</th>
                  <th>Nombre Cliente</th>
                  <th>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {clientes.slice(paginatorState.first, paginatorState.first + paginatorState.rows).map(({ id, cod_Cliente, nombre_Cliente }) => (
                  <tr key={id}>
                    <td>{cod_Cliente}</td>
                    <td>{nombre_Cliente}</td>
                    <td>
                      <button onClick={() => handleEdit(id)} className="btn-edit">Editar</button>
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

          {showModal && clienteEditar && (
            <div className="modal">
              <div className="modal-content">
                <h2>Editar Cliente</h2>
                <form onSubmit={handleUpdateCliente}>
                  <label>Cliente</label>
                  <input type="text" name="cod_Cliente" value={clienteEditar.cod_Cliente} onChange={handleInputChange} />
                  <label>Nombre Cliente</label>
                  <input type="text" name="nombre_Cliente" value={clienteEditar.nombre_Cliente} onChange={handleInputChange} />
                  <div className="modal-actions">
                    <button type="submit" className="btn-save">Guardar</button>
                    <button type="button" className="btn-close" onClick={handleCloseModal}>Cerrar</button>
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

export default FybecaMantenimientoCliente;
