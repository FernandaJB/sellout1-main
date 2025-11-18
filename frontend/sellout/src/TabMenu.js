import React, { useState } from 'react';
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom';
import './css/tabmenu.css'; // Asegúrate de crear este archivo CSS

const TabMenu = ({ user, onLogout }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [isMiniSidebar, setIsMiniSidebar] = useState(false);
  const [activeCompany, setActiveCompany] = useState(null); // Para seguimiento de la empresa activa
  const location = useLocation();
  const navigate = useNavigate();

  const toggleMenu = () => setIsOpen(!isOpen);

  const handleLogout = () => {
    onLogout();
    navigate('/login');
  };

  // Estructura de menú organizada por empresas
  const companies = [
    {
      id: 'fybeca',
      name: 'Fybeca',
      icon: 'M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4',
      color: '#4f46e5',
      items: [
        { path: 'estructura-salarial', label: 'Estructura Salarial', icon: 'M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 14h.01M12 14h.01M15 11h.01M12 11h.01M9 11h.01M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z' },
        { path: 'reportes', label: 'Reportes', icon: 'M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z' },
        { path: 'configuracion', label: 'Configuración', icon: 'M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z' },
      ]
    },
    {
      id: 'deprati',
      name: 'Deprati',
      icon: 'M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z',
      color: '#e11d48',
      items: [
        { path: 'ventas', label: 'Ventas', icon: 'M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z' },
      ]
    }
  ];

  // Determinar si estamos en una ruta específica de una empresa
  const getActiveCompanyFromPath = () => {
    for (const company of companies) {
      for (const item of company.items) {
        if (location.pathname.includes(item.path)) {
          return company.id;
        }
      }
    }
    return null;
  };

  // Si no hay empresa activa, intentar determinarla desde la ruta
  if (!activeCompany) {
    const companyFromPath = getActiveCompanyFromPath();
    if (companyFromPath) {
      setActiveCompany(companyFromPath);
    }
  }

  return (
    <div className="flex h-screen bg-gray-100">
      {/* Sidebar */}
      <div 
        className={`bg-gray-900 text-white ${isMiniSidebar ? 'w-16' : 'w-64'} space-y-6 py-7 px-2 absolute inset-y-0 left-0 transform ${
          isOpen ? 'translate-x-0' : '-translate-x-full'
        } md:relative md:translate-x-0 transition duration-200 ease-in-out z-20`}
      >
        <button
          onClick={() => setIsMiniSidebar(!isMiniSidebar)}
          className="hidden md:block absolute right-0 top-2 bg-gray-800 p-1 rounded-l-md"
        >
          <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={isMiniSidebar ? "M13 5l7 7-7 7M5 5l7 7-7 7" : "M11 19l-7-7 7-7m8 14l-7-7 7-7"} />
          </svg>
        </button>

        <div className="px-4 py-2">
          <h2 className={`text-lg font-semibold ${isMiniSidebar ? 'text-center' : ''}`}>
            {isMiniSidebar ? 'S1' : 'SellOut'}
          </h2>
        </div>

        <nav className="space-y-2">
          {companies.map((company) => (
            <div key={company.id} className="space-y-2">
              {!isMiniSidebar && (
                <h3 className="px-4 text-xs font-semibold text-gray-400 uppercase tracking-wider">
                  {company.name}
                </h3>
              )}
              
              {company.items.map((item) => (
                <Link
                  key={item.path}
                  to={`/app/${item.path}`}
                  className={`flex items-center ${isMiniSidebar ? 'justify-center' : 'space-x-2'} px-3 py-2 rounded-md text-sm font-medium transition duration-150 ease-in-out ${
                    location.pathname.includes(item.path) ? 'bg-gray-800 text-white' : 'text-gray-300 hover:bg-gray-700 hover:text-white'
                  }`}
                  onClick={() => {
                    setIsOpen(false);
                    setActiveCompany(company.id);
                  }}
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={item.icon} />
                  </svg>
                  {!isMiniSidebar && <span>{item.label}</span>}
                </Link>
              ))}
            </div>
          ))}
        </nav>
        
        <button
          onClick={handleLogout}
          className={`flex items-center ${isMiniSidebar ? 'justify-center' : 'space-x-2'} w-full px-3 py-2 mt-auto text-sm font-medium text-white bg-red-600 hover:bg-red-700 rounded-md transition duration-150 ease-in-out`}
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
          </svg>
          {!isMiniSidebar && <span>Cerrar sesión</span>}
        </button>
      </div>

      {/* Main content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        <header className="bg-white shadow-sm">
          <div className="max-w-7xl mx-auto py-4 px-4 sm:px-6 lg:px-8 flex justify-between items-center">
            <button onClick={toggleMenu} className="md:hidden text-gray-500 hover:text-gray-600 focus:outline-none focus:text-gray-600">
              <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            </button>
            <h1 className="text-xl font-semibold text-gray-900">Bienvenido, {user.name || user.username || user.cedulaEmpleado}</h1>
          </div>
        </header>
        
        <main className="flex-1 overflow-x-hidden overflow-y-auto bg-gray-100">
          {/* Si estamos en la ruta principal, mostrar el dashboard de empresas */}
          {location.pathname === '/app' ? (
            <div className="container mx-auto px-4 sm:px-6 lg:px-8 py-8">
              <h2 className="text-2xl font-bold text-gray-800 mb-6">Seleccione una empresa</h2>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {companies.map((company) => (
                  <div 
                    key={company.id}
                    className="company-card"
                    style={{
                      '--company-color': company.color
                    }}
                    onClick={() => {
                      setActiveCompany(company.id);
                      // Navegar a la primera opción de la empresa
                      if (company.items.length > 0) {
                        navigate(`/app/${company.items[0].path}`);
                      }
                    }}
                  >
                    <div className="company-icon">
                      <svg className="w-12 h-12" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={company.icon} />
                      </svg>
                    </div>
                    <h3 className="company-name">{company.name}</h3>
                    <div className="company-options">
                      {company.items.map((item, index) => (
                        <div key={index} className="company-option">
                          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={item.icon} />
                          </svg>
                          <span>{item.label}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="container mx-auto px-4 sm:px-6 lg:px-8 py-6">
              <div className="bg-white shadow-sm rounded-lg p-6">
                <Outlet />
              </div>
            </div>
          )}
        </main>
      </div>

      {/* Overlay */}
      {isOpen && (
        <div 
          className="fixed inset-0 bg-black bg-opacity-50 z-10 md:hidden"
          onClick={() => setIsOpen(false)}
        ></div>
      )}
    </div>
  );
};

export default TabMenu;