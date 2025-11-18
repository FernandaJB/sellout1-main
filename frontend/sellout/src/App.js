import React, { useState, useEffect } from 'react';
import { BrowserRouter as Router, Route, Routes, Navigate } from 'react-router-dom';
import { FaSignOutAlt, FaMedkit, FaShoppingBag, FaFileExcel, FaUsers } from 'react-icons/fa'; // 👈 FaUsers para Clientes
import Login from './login';
import Registrar from './Registrar';
import OlvidarContraseña from './OlvidarContraseña';
import RestablecerContrasenia from './RestablecerContrasenia';
import FybecaMantenimientoProducto from './FybecaMantenimientoProducto';
import FybecaTemplate from './FybecaTemplate';
import FybecaTipoMueble from './FybecaTipoMueble';
import DepratiTipoMueble from './DepratiTipoMueble';
import DepratiTemplate from './DepratiTemplate';
import TemplateGeneral from './TemplateGeneral';
import Cliente from './Cliente'; // 👈 NUEVO

import './App.css';
import './css/menu-dashboard.css';
import "primereact/resources/themes/lara-light-indigo/theme.css";
import "primereact/resources/primereact.min.css";
import "primeicons/primeicons.css";

const App = () => {
  const [user, setUser] = useState(null);
  const [activeTab, setActiveTab] = useState('');
  const [selectedCompany, setSelectedCompany] = useState(null);

  useEffect(() => {
    const accessToken = localStorage.getItem('access_token');
    if (accessToken) {
      try {
        const userInfo = parseJwt(accessToken);
        const storedUserData = {
          username: localStorage.getItem('username') || localStorage.getItem('cedulaEmpleado'),
          email: userInfo.email,
          id: userInfo.id,
        };
        setUser(storedUserData);
      } catch (error) {
        console.error('Error parsing token:', error);
        localStorage.clear();
      }
    }
  }, []);

  const handleLogin = (userData) => setUser(userData);

  const handleLogout = () => {
    setUser(null);
    localStorage.clear();
    setActiveTab('');
    setSelectedCompany(null);
  };

  const parseJwt = (token) => {
    const base64Url = token.split('.')[1];
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    const jsonPayload = decodeURIComponent(
      atob(base64)
        .split('')
        .map((c) => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
        .join('')
    );
    return JSON.parse(jsonPayload);
  };

  // Empresas y módulos
  const companies = [
    {
      id: 'fybeca',
      name: 'Fybeca',
      icon: <FaMedkit size={32} />,
      color: '#4f46e5',
      modules: [
        { id: 'FybecaTemplate', name: 'Ventas', description: 'Gestión de ventas y transacciones' },
        { id: 'FybecaMantenimientoProducto', name: 'Mantenimiento Producto', description: 'Gestión de inventario y productos' },
        { id: 'FybecaTipoMueble', name: 'Tipo Mueble', description: 'Configuración de tipos de muebles' }
      ]
    },
    {
      id: 'deprati',
      name: 'Deprati',
      icon: <FaShoppingBag size={32} />,
      color: '#e11d48',
      modules: [
        { id: 'DepratiTemplate', name: 'Ventas', description: 'Gestión de ventas y transacciones' },
        { id: 'DepratiTipoMueble', name: 'Tipo Mueble', description: 'Configuración de tipos de muebles' }
      ]
    },
    {
      id: 'template-general',
      name: 'Template General',
      icon: <FaFileExcel size={32} />,
      color: '#16a34a',
      modules: [
        { id: 'TemplateGeneral', name: 'Template General', description: 'Carga por plantilla fija' }
      ]
    },
    {
      id: 'clientes',
      name: 'Clientes',
      icon: <FaUsers size={32} />,
      color: '#0284c7',
      modules: [
        { id: 'Cliente', name: 'Clientes', description: 'Gestión de clientes' }
      ]
    }
  ];

  const renderCompanySelection = () => (
    <div className="menu-company-selection">
      <h2 className="menu-selection-title">Seleccione una empresa</h2>
      <div className="menu-company-grid">
        {companies.map((company) => (
          <div
            key={company.id}
            className="menu-company-card"
            style={{ borderColor: company.color }}
            onClick={() => setSelectedCompany(company)}
          >
            <div className="menu-company-icon" style={{ backgroundColor: `${company.color}20`, color: company.color }}>
              {company.icon}
            </div>
            <h3 className="menu-company-name">{company.name}</h3>
            <p className="menu-company-description">
              {company.modules.length} módulo{company.modules.length !== 1 ? 's' : ''} disponible{company.modules.length !== 1 ? 's' : ''}
            </p>
          </div>
        ))}
      </div>
    </div>
  );

  const renderModuleSelection = () => {
    if (!selectedCompany) return null;

    return (
      <div className="menu-module-selection">
        <div className="menu-selection-header">
          <button className="menu-back-button" onClick={() => setSelectedCompany(null)}>
            ← Volver a empresas
          </button>
          <h2 className="menu-selection-title">Módulos de {selectedCompany.name}</h2>
        </div>

        <div className="menu-module-grid">
          {selectedCompany.modules.map((module) => (
            <div
              key={module.id}
              className={`menu-module-card ${activeTab === module.id ? 'active' : ''}`}
              style={{ borderColor: selectedCompany.color }}
              onClick={() => setActiveTab(module.id)}
            >
              <div className="menu-module-icon" style={{ backgroundColor: `${selectedCompany.color}20`, color: selectedCompany.color }}>
                {selectedCompany.icon}
              </div>
              <h3 className="menu-module-name">{module.name}</h3>
              <p className="menu-module-description">{module.description}</p>
            </div>
          ))}
        </div>
      </div>
    );
  };

  return (
    <div className="app-container">
      <div className="app-header">
        <h1>Sell Out</h1>
        {user && (
          <div className="header-actions">
            <span className="user-info">Bienvenido, {user.username}</span>
            <button onClick={handleLogout} className="logout-button">
              <FaSignOutAlt /> Salir
            </button>
          </div>
        )}
      </div>
      <Routes>
        <Route path="/login" element={<Login onLogin={handleLogin} />} />
        <Route path="/Registrar" element={<Registrar />} />
        <Route path="/OlvidarContraseña" element={<OlvidarContraseña />} />
        <Route path="/RestablecerContrasenia" element={<RestablecerContrasenia />} />
        <Route
          path="/"
          element={
            user ? (
              !activeTab ? (
                selectedCompany ? renderModuleSelection() : renderCompanySelection()
              ) : (
                <>
                  <div className="menu-module-header">
                    <button
                      className="menu-back-button"
                      onClick={() => {
                        setActiveTab('');
                      }}
                    >
                      ← Volver a módulos
                    </button>
                    <h2 className="menu-module-title">
                      {selectedCompany?.name} - {selectedCompany?.modules.find((m) => m.id === activeTab)?.name}
                    </h2>
                  </div>

                  {activeTab === 'FybecaTemplate' && <FybecaTemplate />}
                  {activeTab === 'TemplateGeneral' && <TemplateGeneral />}
                  {activeTab === 'FybecaMantenimientoProducto' && <FybecaMantenimientoProducto />}
                  {activeTab === 'FybecaTipoMueble' && <FybecaTipoMueble />}
                  {activeTab === 'DepratiTemplate' && <DepratiTemplate />}
                  {activeTab === 'DepratiTipoMueble' && <DepratiTipoMueble />}
                  {activeTab === 'Cliente' && <Cliente />}{/* 👈 Render nuevo */}
                </>
              )
            ) : (
              <Navigate to="/login" replace />
            )
          }
        />
      </Routes>
    </div>
  );
};

const AppWrapper = () => (
  <Router>
    <App />
  </Router>
);

export default AppWrapper;
