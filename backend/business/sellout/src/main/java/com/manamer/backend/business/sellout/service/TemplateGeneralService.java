package com.manamer.backend.business.sellout.service;

import com.manamer.backend.business.sellout.models.Cliente;
import com.manamer.backend.business.sellout.models.Venta;
import com.manamer.backend.business.sellout.repositories.VentaRepository;
import jakarta.persistence.EntityManager;
import jakarta.persistence.Query;
import org.apache.poi.ss.usermodel.*;
import org.apache.poi.util.IOUtils;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

import java.io.InputStream;
import java.text.Normalizer;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.*;
import java.util.logging.Logger;

@Service
public class TemplateGeneralService {

    private static final Logger log = Logger.getLogger(TemplateGeneralService.class.getName());

    private static final int CHUNK_SIZE  = 10_000; // filas del Excel por chunk
    private static final int BATCH_SIZE  = 1_000;  // flush/clear cada N upserts
    private static final int IN_LIMIT    = 1_000;  // tamaño máximo de IN (...) por consulta nativa

    // === Límites para borrado masivo ===
    private static final int DELETE_UI_BATCH       = 5_000; // objetivo por acción del usuario
    private static final int SQLSERVER_PARAM_LIMIT = 2_100; // límite duro SQL Server
    private static final int PARAMS_POR_FILA       = 4;     // anio, mes, codBarra, codPdv
    private static final int FILAS_POR_SENTENCIA   = 500;   // 500*4 = 2000 < 2100 (seguro)

    private static final String HOJA = "Base";
    private static final int FILA_ENCAB = 3; // 0-based => fila 4
    private static final int FILA_DATOS = 4; // 0-based => fila 5
    private static final int COL_INI = 1;    // B
    private static final int COL_FIN = 13;   // N

    private static final List<String> HEADERS = List.of(
            "CODCLIENTE","CLIENTE","DIA","MES","CODBARRA","DESCRIPCION",
            "MARCA","COD LOCAL","CIUDAD","NOMBRE LOCAL","STOCK PDV","VENTA EN UNIDADES","VENTA EN DOLARES"
    );

    private static final int IDX_CODCLIENTE    = 0;  // B
    private static final int IDX_CLIENTE       = 1;  // C
    private static final int IDX_DIA           = 2;  // D (no se usa)
    private static final int IDX_MES           = 3;  // E (fecha)
    private static final int IDX_COD_BARRA     = 4;  // F
    private static final int IDX_DESCRIPCION   = 5;  // G
    private static final int IDX_MARCA         = 6;  // H
    private static final int IDX_COD_LOCAL     = 7;  // I
    private static final int IDX_CIUDAD        = 8;  // J
    private static final int IDX_NOMBRE_LOCAL  = 9;  // K
    private static final int IDX_STOCK_PDV     = 10; // L
    private static final int IDX_VTA_UNIDADES  = 11; // M
    private static final int IDX_VTA_DOLARES   = 12; // N

    private static final List<java.time.format.DateTimeFormatter> DATE_FORMATS = List.of(
            java.time.format.DateTimeFormatter.ofPattern("dd/MM/uuuu"),
            java.time.format.DateTimeFormatter.ofPattern("d/M/uuuu"),
            java.time.format.DateTimeFormatter.ofPattern("dd-MM-uuuu"),
            java.time.format.DateTimeFormatter.ofPattern("d-M-uuuu"),
            java.time.format.DateTimeFormatter.ISO_LOCAL_DATE,
            java.time.format.DateTimeFormatter.ofPattern("MM/dd/uuuu"),
            java.time.format.DateTimeFormatter.ofPattern("M/d/uuuu")
    );

    // ✅ CAMBIO: placeholder para que tienda vacía/no venga no se mezcle
    private static final String PDV_PLACEHOLDER = "SIN_TIENDA";

    private final VentaRepository ventaRepository;
    private final ClienteService clienteService; // compatibilidad
    private final EntityManager em;
    private final TransactionTemplate txTemplate;

    static {
        // Permitir Excels grandes
        IOUtils.setByteArrayMaxOverride(200 * 1024 * 1024);
    }

    public TemplateGeneralService(
            VentaRepository ventaRepository,
            EntityManager entityManager,
            ClienteService clienteService,
            PlatformTransactionManager ptm
    ) {
        this.ventaRepository = ventaRepository;
        this.em = entityManager;
        this.clienteService = clienteService;
        this.txTemplate = new TransactionTemplate(ptm);
    }

    // =========================
    //       CARGA EXCEL
    // =========================
    public Map<String, Object> cargarTemplateGeneral(InputStream excelStream, String nombreArchivo) {
        int insertados = 0, actualizados = 0, omitidos = 0;
        int filasLeidas = 0, filasConCodCliente = 0;

        List<String> incidencias = new ArrayList<>();
        List<Map<String, Object>> codigosNoEncontrados = new ArrayList<>();
        List<Map<String, Object>> detalleOmitidos = new ArrayList<>();
        List<Map<String, Object>> detalleInsertados = new ArrayList<>();
        List<Map<String, Object>> detalleActualizados = new ArrayList<>();
        Set<String> codigosAfectados = new TreeSet<>();

        try (Workbook wb = WorkbookFactory.create(excelStream)) {
            Sheet sheet = getHojaBase(wb).orElseThrow(() ->
                    new IllegalArgumentException("Falta la hoja 'Base'."));

            List<String> headers = leerEncabezados(sheet);
            if (!headers.equals(HEADERS)) {
                String msg = "Encabezados en B4:N4 no coinciden (se normaliza a MAYÚSCULAS, sin tildes, espacios colapsados).";
                incidencias.add(msg);
                codigosNoEncontrados.add(Map.of("codigo", "ENCABEZADOS", "motivo", msg));
            }

            List<RegistroFila> buffer = new ArrayList<>(CHUNK_SIZE);
            int vaciosConsecutivos = 0;

            for (int r = FILA_DATOS; r <= sheet.getLastRowNum(); r++) {
                Row row = sheet.getRow(r);
                filasLeidas++;

                String codClienteRaw    = getCellText(row, COL_INI + IDX_CODCLIENTE);
                String nombreClienteRaw = getCellText(row, COL_INI + IDX_CLIENTE);

                String codCliente    = safeTrim(codClienteRaw);
                String nombreCliente = safeTrim(nombreClienteRaw);

                if (isBlank(codCliente) && isBlank(nombreCliente)) {
                    vaciosConsecutivos++;
                    if (vaciosConsecutivos >= 2) break;
                    else continue;
                } else {
                    vaciosConsecutivos = 0;
                    filasConCodCliente++;
                }

                int excelFila = r + 1;

                LocalDate fecha    = getCellDate(row, COL_INI + IDX_MES);
                String codBarra    = safeTrim(getCellText(row, COL_INI + IDX_COD_BARRA));
                String descripcion = safeTrim(getCellText(row, COL_INI + IDX_DESCRIPCION));
                String marca       = safeTrim(getCellText(row, COL_INI + IDX_MARCA));
                Integer codLocal   = getCellInteger(row, COL_INI + IDX_COD_LOCAL);
                String codPdv      = codLocal == null ? null : String.valueOf(codLocal).trim();
                String ciudad      = safeTrim(getCellText(row, COL_INI + IDX_CIUDAD));
                String pdv         = safeTrim(getCellText(row, COL_INI + IDX_NOMBRE_LOCAL));

                Integer ventaUnidades = getCellInteger(row, COL_INI + IDX_VTA_UNIDADES);
                Double  ventaUSD      = getCellDouble(row,  COL_INI + IDX_VTA_DOLARES);
                Integer stockUnidades = getCellInteger(row, COL_INI + IDX_STOCK_PDV);

                if (fecha == null) {
                    omitidos++;
                    detalleOmitidos.add(Map.of(
                            "fila", excelFila, "codBarra", Objects.toString(codBarra, ""),
                            "codPdv", Objects.toString(codPdv, ""),
                            "motivo", "Columna MES inválida (esperado dd/MM/yyyy o fecha Excel)."
                    ));
                    codigosNoEncontrados.add(Map.of(
                            "codigo", Objects.toString(codBarra, "SIN_COD_BARRA"),
                            "motivo", "Fecha (MES) inválida. Fila: " + excelFila
                    ));
                    continue;
                }
                if (isBlank(codBarra)) {
                    omitidos++;
                    detalleOmitidos.add(Map.of(
                            "fila", excelFila, "codBarra", "", "codPdv", Objects.toString(codPdv, ""),
                            "motivo", "CODBARRA vacío."
                    ));
                    codigosNoEncontrados.add(Map.of("codigo", "CODBARRA_VACIO", "motivo", "CODBARRA vacío. Fila: " + excelFila));
                    continue;
                }
                if (isBlank(pdv) && isBlank(codPdv)) {
                    omitidos++;
                    detalleOmitidos.add(Map.of(
                            "fila", excelFila, "codBarra", Objects.toString(codBarra, ""),
                            "codPdv", "", "motivo", "Faltan datos de PDV (NOMBRE LOCAL y COD LOCAL)."
                    ));
                    codigosNoEncontrados.add(Map.of(
                            "codigo", codBarra,
                            "motivo", "Faltan datos de PDV (NOMBRE LOCAL y COD LOCAL). Fila: " + excelFila
                    ));
                    continue;
                }

                // ✅ CAMBIO ÚNICO: si codPdv viene vacío/null, usar placeholder para no mezclar tiendas
                if (isBlank(codPdv)) codPdv = PDV_PLACEHOLDER;

                RegistroFila rf = new RegistroFila(
                        excelFila, codCliente, nombreCliente, fecha,
                        codBarra, descripcion, marca, codPdv, ciudad, pdv,
                        ventaUnidades, ventaUSD, stockUnidades
                );
                buffer.add(rf);

                if (buffer.size() >= CHUNK_SIZE) {
                    int[] res = txTemplate.execute(status ->
                            procesarChunk(buffer, detalleInsertados, detalleActualizados,
                                    detalleOmitidos, codigosAfectados, codigosNoEncontrados)
                    );
                    insertados += res[0];
                    actualizados += res[1];
                    omitidos += res[2];
                    buffer.clear();
                }
            }

            if (!buffer.isEmpty()) {
                int[] res = txTemplate.execute(status ->
                        procesarChunk(buffer, detalleInsertados, detalleActualizados,
                                detalleOmitidos, codigosAfectados, codigosNoEncontrados)
                );
                insertados += res[0];
                actualizados += res[1];
                omitidos += res[2];
                buffer.clear();
            }

        } catch (Exception ex) {
            log.severe("Error al procesar CU4: " + ex.getMessage());
            incidencias.add("ERROR FATAL: " + ex.getMessage());
            codigosNoEncontrados.add(Map.of(
                    "codigo", "GENERAL",
                    "motivo", "ERROR FATAL: " + String.valueOf(ex.getMessage())
            ));
        }

        Map<String, Object> out = new LinkedHashMap<>();
        out.put("ok", incidencias.stream().noneMatch(s -> s.startsWith("ERROR")));
        out.put("archivo", nombreArchivo);
        out.put("filasLeidas", filasLeidas);
        out.put("filasConCodCliente", filasConCodCliente);
        out.put("insertados", insertados);
        out.put("actualizados", actualizados);
        out.put("omitidos", omitidos);
        out.put("errores", (int) incidencias.stream().filter(s -> s.startsWith("Error") || s.startsWith("ERROR")).count());
        if (!incidencias.isEmpty()) out.put("incidencias", incidencias);
        out.put("codigosNoEncontrados", codigosNoEncontrados);
        out.put("detalleOmitidos", detalleOmitidos);
        out.put("detalleInsertados", detalleInsertados);
        out.put("detalleActualizados", detalleActualizados);
        out.put("codigosAfectados", new ArrayList<>(codigosAfectados));
        return out;
    }

    /** Procesa un chunk con validación de existencia en SAP por CODBARRA y asigna el cliente_id correcto. */
    private int[] procesarChunk(
            List<RegistroFila> chunk,
            List<Map<String, Object>> detalleInsertados,
            List<Map<String, Object>> detalleActualizados,
            List<Map<String, Object>> detalleOmitidos,
            Set<String> codigosAfectados,
            List<Map<String, Object>> codigosNoEncontrados
    ) {
        // 1) Recolectar dominios y map (codCliente -> nombre) para precrear/obtener ID
        Set<String> codBarras   = new HashSet<>();
        Set<String> codPdvs     = new HashSet<>();
        Set<Integer> anios      = new HashSet<>();
        Set<Integer> meses      = new HashSet<>();
        Set<Integer> dias = new HashSet<>();

        Map<String, String> codClienteToNombre = new LinkedHashMap<>();
        for (RegistroFila rf : chunk) {
            if (!isBlank(rf.codCliente)) {
                String codeUpper = rf.codCliente.trim().toUpperCase(Locale.ROOT);
                if (!codClienteToNombre.containsKey(codeUpper)) {
                    codClienteToNombre.put(codeUpper, isBlank(rf.nombreCliente) ? null : rf.nombreCliente.trim());
                } else if (codClienteToNombre.get(codeUpper) == null && !isBlank(rf.nombreCliente)) {
                    codClienteToNombre.put(codeUpper, rf.nombreCliente.trim());
                }
            }
            if (rf.codBarra != null) codBarras.add(rf.codBarra);
            if (rf.codPdv != null)   codPdvs.add(rf.codPdv);
            anios.add(rf.fecha.getYear());
            meses.add(rf.fecha.getMonthValue());
            dias.add(rf.fecha.getDayOfMonth());

        }

        // 2) Prefetch SAP por codBarra (con OPENQUERY para evitar 7399)
        Map<String, String> sapByCb = prefetchSapByCodBarra(codBarras);

        // 3) Resolver/crear clientes y obtener sus IDs
        Map<String, Cliente> clientes = prefetchClientes(codClienteToNombre, codigosNoEncontrados);
        Map<String, Cliente> clientesPorCodigo = new HashMap<>();
        for (Cliente c : clientes.values()) {
            clientesPorCodigo.putIfAbsent(soloCod(c.getCodCliente()), c);
        }
        for (String codeUpper : codClienteToNombre.keySet()) {
            if (!clientesPorCodigo.containsKey(codeUpper)) {
                clienteService.findByCodCliente(codeUpper).ifPresent(c -> clientesPorCodigo.put(codeUpper, c));
            }
        }

        // 4) Prefetch de ventas EXISTENTES por clienteId
        Set<Long> clienteIds = new HashSet<>();
        for (Cliente c : clientesPorCodigo.values()) if (c.getId() != null) clienteIds.add(c.getId());
        Map<String, Venta> ventasExistentes =
                prefetchVentas(anios, meses, dias, codBarras, codPdvs, clienteIds);

        int insertados = 0, actualizados = 0, omitidos = 0, i = 0;

        for (RegistroFila rf : chunk) {
            // 4.1 Resolver cliente para la fila (ID real)
            Cliente clienteFila = resolverClienteParaFila(rf, clientes, clientesPorCodigo);

            if (clienteFila == null || clienteFila.getId() == null) {
                omitidos++;
                detalleOmitidos.add(Map.of(
                        "fila", rf.excelFila,
                        "codBarra", Objects.toString(rf.codBarra, ""),
                        "codPdv", Objects.toString(rf.codPdv, ""),
                        "motivo", "No se pudo resolver cliente_id para el codCliente de la fila."
                ));
                codigosNoEncontrados.add(Map.of(
                        "codigo", Objects.toString(rf.codCliente, "SIN_CODCLIENTE"),
                        "motivo", "No se pudo resolver cliente_id. Fila: " + rf.excelFila
                ));
                continue;
            }

            // 4.2 Validar que el codBarra exista en SAP
            String sap = sapByCb.get(rf.codBarra);
            if (sap == null) {
                omitidos++;
                detalleOmitidos.add(Map.of(
                        "fila", rf.excelFila,
                        "codBarra", rf.codBarra,
                        "codPdv", Objects.toString(rf.codPdv, ""),
                        "motivo", "CODBARRA no existe en SAP (cache)."
                ));
                if (rf.codBarra != null && !rf.codBarra.trim().isEmpty()) {
                    codigosNoEncontrados.add(Map.of(
                            "codigo", rf.codBarra,
                            "motivo", "CODBARRA no existe en SAP (cache). Fila: " + rf.excelFila
                    ));
                } else {
                    codigosNoEncontrados.add(Map.of(
                            "codigo", "CODBARRA_VACIO",
                            "motivo", "CODBARRA vacío. Fila: " + rf.excelFila
                    ));
                }
                continue;
            }

            // 4.3 Upsert *por cliente_id* + (anio, mes, codBarra, codPdv)
            String key = buildKey(
                    rf.fecha.getYear(),
                    rf.fecha.getMonthValue(),
                    rf.fecha.getDayOfMonth(),
                    rf.codBarra,
                    rf.codPdv,
                    clienteFila.getId()
            );

            Venta v = ventasExistentes.get(key);
            boolean esNuevo = false;

            if (v == null) {
                v = new Venta();
                v.setAnio(rf.fecha.getYear());
                v.setMes(rf.fecha.getMonthValue());
                v.setCodBarra(rf.codBarra);
                v.setCodPdv(rf.codPdv);
                v.setCliente(clienteFila);
                esNuevo = true;
            } else {
                v.setCliente(clienteFila);
            }

            v.setDia(rf.fecha.getDayOfMonth());
            v.setMarca(rf.marca);
            v.setNombreProducto(rf.descripcion);
            v.setDescripcion(rf.descripcion);
            v.setPdv(rf.pdv);
            v.setCiudad(rf.ciudad);
            v.setVentaUnidad(rf.ventaUnidades != null ? rf.ventaUnidades : 0);
            v.setVentaDolares(rf.ventaUSD != null ? rf.ventaUSD : 0.0);
            v.setStockUnidades(rf.stockUnidades != null ? rf.stockUnidades : 0);
            v.setStockDolares(0);
            v.setUnidadesDiarias("0");
            v.setCodigoSap(sap);

            if (esNuevo) {
                em.persist(v);
                ventasExistentes.put(key, v);
                insertados++;
                detalleInsertados.add(Map.of(
                        "fila", rf.excelFila,
                        "codBarra", rf.codBarra,
                        "codPdv", Objects.toString(rf.codPdv, ""),
                        "ventaUnidades", Objects.toString(rf.ventaUnidades, ""),
                        "ventaUSD", Objects.toString(rf.ventaUSD, "")
                ));
            } else {
                actualizados++;
                detalleActualizados.add(Map.of(
                        "fila", rf.excelFila,
                        "codBarra", rf.codBarra,
                        "codPdv", Objects.toString(rf.codPdv, ""),
                        "ventaUnidades", Objects.toString(rf.ventaUnidades, ""),
                        "ventaUSD", Objects.toString(rf.ventaUSD, "")
                ));
            }

            codigosAfectados.add(rf.codBarra);

            if (++i % BATCH_SIZE == 0) {
                em.flush();
                em.clear();
            }
        }

        em.flush();
        em.clear();

        return new int[]{insertados, actualizados, omitidos};
    }

    // ==== Prefetch helpers (ahora con cliente_id en la clave) ====

    @SuppressWarnings("unchecked")
    private Map<String, Venta> prefetchVentas(Set<Integer> anios, Set<Integer> meses, Set<Integer> dias,
                                             Set<String> codBarras, Set<String> codPdvs, Set<Long> clienteIds)
    {
        Map<String, Venta> out = new HashMap<>();
        if (anios.isEmpty() || meses.isEmpty() || codBarras.isEmpty() || clienteIds.isEmpty()) return out;

        List<Integer> aniosL = new ArrayList<>(anios);
        List<Integer> mesesL = new ArrayList<>(meses);
        List<String> barrasL = new ArrayList<>(codBarras);
        List<String> pdvsL   = new ArrayList<>(codPdvs);
        List<Long>   clientesL = new ArrayList<>(clienteIds);

        for (List<String> barrasChunk : partitions(barrasL, IN_LIMIT)) {
            List<String> pdvsChunk = pdvsL.isEmpty() ? List.of("") : pdvsL;
            for (List<String> pdvSub : partitions(pdvsChunk, IN_LIMIT)) {
                for (List<Long> clientesSub : partitions(clientesL, IN_LIMIT)) {
                    String jpql =
                            "SELECT v FROM Venta v " +
                            "WHERE v.anio IN :anios AND v.mes IN :meses AND v.dia IN :dias " +
                            "AND v.codBarra IN :barras " +
                            (codPdvs.isEmpty()
                                    ? "AND v.codPdv IS NULL "
                                    : "AND (v.codPdv IN :pdvs OR v.codPdv IS NULL) ") +
                            "AND v.cliente.id IN :clientes";

                    var q = em.createQuery(jpql, Venta.class)
                            .setParameter("anios", aniosL)
                            .setParameter("meses", mesesL)
                            .setParameter("dias", new ArrayList<>(dias))
                            .setParameter("barras", barrasChunk)
                            .setParameter("clientes", clientesSub);

                    if (!codPdvs.isEmpty()) q.setParameter("pdvs", pdvSub);

                    List<Venta> res = q.getResultList();
                    for (Venta v : res) {
                        String k = buildKey(
                                v.getAnio(),
                                v.getMes(),
                                v.getDia(),
                                v.getCodBarra(),
                                v.getCodPdv(),
                                (v.getCliente() != null ? v.getCliente().getId() : null)
                        );

                        out.put(k, v);
                    }
                    em.clear();
                }
            }
        }
        return out;
    }

    private static String buildKey(Integer anio, Integer mes, Integer dia,
                                   String codBarra, String codPdv, Long clienteId) {

        return (anio == null ? "" : anio) + "|" +
                (mes == null ? "" : mes) + "|" +
                (dia == null ? "" : dia) + "|" +
                (codBarra == null ? "" : codBarra.trim()) + "|" +
                (codPdv == null ? "" : codPdv.trim()) + "|" +
                (clienteId == null ? "" : clienteId);
    }

    private static String soloCod(String codCliente) {
        return codCliente == null ? null : codCliente.trim().toUpperCase(Locale.ROOT);
    }

    /**
     * Prefetch de SAP_Prod por CodBarra usando OPENQUERY para evitar error 7399 del linked server.
     * Aplica el WHERE IN del lado de SQL Server con parámetros posicionales (?, ?, ...).
     */
    @SuppressWarnings("unchecked")
    private Map<String, String> prefetchSapByCodBarra(Set<String> codBarras) {
        Map<String, String> out = new HashMap<>();
        if (codBarras.isEmpty()) return out;

        List<String> barrasL = new ArrayList<>(codBarras);

        for (List<String> chunk : partitions(barrasL, IN_LIMIT)) {
            // Construimos placeholders "?, ?, ?, ..."
            String placeholders = String.join(",", Collections.nCopies(chunk.size(), "?"));

            String sql =
                    "SELECT p.cod_barra, MAX(p.codigo_sap) AS codigo_sap " +
                    "FROM SELLOUT.dbo.SAP_Prod_cache p " +
                    "WHERE p.cod_barra IN (" + placeholders + ") " +
                    "GROUP BY p.cod_barra";

            try {
                Query q = em.createNativeQuery(sql);

                int idx = 1;
                for (String cb : chunk) q.setParameter(idx++, cb);

                List<Object[]> rows = q.getResultList();
                for (Object[] row : rows) {
                    String cb = row[0] != null ? row[0].toString().trim() : null;
                    String cp = row[1] != null ? row[1].toString().trim() : null;
                    if (cb != null && cp != null) out.put(cb, cp);
                }
            } catch (Exception ex) {
                log.severe("prefetchSapByCodBarra cache falló. chunkSize=" +
                        chunk.size() + " | error=" + ex.getMessage());
            } finally {
                em.clear();
            }
        }
        return out;
    }

    /**
     * Crea clientes SOLO si NO existe el par (codCliente, nombreCliente) ignorando TRIM/UPPER.
     * - No actualiza clientes existentes.
     * - Permite múltiples filas con MISMO codCliente pero distinto nombreCliente (según tu regla).
     * - Usa verificación *batch* con VALUES para eficiencia en SQL Server.
     */
    private Map<String, Cliente> prefetchClientes(
            Map<String, String> codClienteToNombre,
            List<Map<String, Object>> codigosNoEncontrados
    ) {
        Map<String, Cliente> out = new HashMap<>();
        if (codClienteToNombre == null || codClienteToNombre.isEmpty()) return out;

        // 1) Construir pares normalizados (TRIM+UPPER) => key "COD|NOMBRE"
        LinkedHashMap<String, String> paresNorm = new LinkedHashMap<>();
        for (Map.Entry<String, String> e : codClienteToNombre.entrySet()) {
            String cod = e.getKey();
            String nom = e.getValue();
            if (cod == null || nom == null) continue;
            String codTrim = cod.trim();
            String nomTrim = nom.trim();
            if (codTrim.isEmpty() || nomTrim.isEmpty()) continue;
            String key = codTrim.toUpperCase(Locale.ROOT) + "|" + nomTrim.toUpperCase(Locale.ROOT);
            paresNorm.putIfAbsent(key, nomTrim);
        }
        if (paresNorm.isEmpty()) return out;

        // 2) Verificar EXISTENTES por lote usando JOIN a VALUES (normalizando TRIM/UPPER en SQL)
        final int LOTE = IN_LIMIT; // 1000
        List<String> keys = new ArrayList<>(paresNorm.keySet());
        Set<String> existentes = new HashSet<>();

        for (int i = 0; i < keys.size(); i += LOTE) {
            int j = Math.min(i + LOTE, keys.size());
            List<String> sub = keys.subList(i, j);

            StringBuilder sb = new StringBuilder();
            sb.append("SELECT DISTINCT ")
              .append(" UPPER(LTRIM(RTRIM(c.cod_cliente))) + '|' + UPPER(LTRIM(RTRIM(c.nombre_cliente))) AS par_norm ")
              .append("FROM SELLOUT.dbo.cliente c ")
              .append("JOIN (VALUES ");

            for (int k = 0; k < sub.size(); k++) {
                if (k > 0) sb.append(",");
                sb.append("(?, ?)");
            }
            sb.append(") V(cod_raw, nom_raw) ")
              .append(" ON UPPER(LTRIM(RTRIM(c.cod_cliente))) = UPPER(LTRIM(RTRIM(V.cod_raw))) ")
              .append("AND UPPER(LTRIM(RTRIM(c.nombre_cliente))) = UPPER(LTRIM(RTRIM(V.nom_raw)))");

            Query q = em.createNativeQuery(sb.toString());

            int p = 1;
            for (String par : sub) {
                int sep = par.indexOf('|');
                String codU = par.substring(0, sep);
                String nomU = par.substring(sep + 1);
                q.setParameter(p++, codU);
                q.setParameter(p++, nomU);
            }

            @SuppressWarnings("unchecked")
            List<Object> rows = q.getResultList();
            em.clear();

            for (Object row : rows) {
                if (row != null) existentes.add(row.toString());
            }
        }

        // 3) Crear faltantes
        int i = 0;
        for (String par : keys) {
            if (existentes.contains(par)) continue;

            int sep = par.indexOf('|');
            String codUpper = par.substring(0, sep);
            String nombreTrimOriginal = paresNorm.get(par);

            try {
                Cliente nuevo = new Cliente();
                nuevo.setCodCliente(codUpper);
                nuevo.setNombreCliente(nombreTrimOriginal);
                em.persist(nuevo);

                if (++i % BATCH_SIZE == 0) { em.flush(); em.clear(); }

                out.put(par, nuevo);
            } catch (Exception e) {
                codigosNoEncontrados.add(Map.of(
                        "codigo", codUpper,
                        "motivo", "Error al crear cliente (par cod+nombre): " + e.getMessage()
                ));
                log.severe("Error al crear cliente [" + par + "]: " + e.getMessage());
            }
        }

        // 4) Cargar al map los existentes desde DB también (para obtener sus IDs)
        for (String par : keys) {
            if (out.containsKey(par)) continue;
            int sep = par.indexOf('|');
            String codUpper = par.substring(0, sep);
            String nomUpper = par.substring(sep + 1);
            String sql = "SELECT TOP 1 id, cod_cliente, nombre_cliente FROM SELLOUT.dbo.cliente " +
                    "WHERE UPPER(LTRIM(RTRIM(cod_cliente))) = ? AND UPPER(LTRIM(RTRIM(nombre_cliente))) = ?";
            Query q = em.createNativeQuery(sql);
            q.setParameter(1, codUpper);
            q.setParameter(2, nomUpper);
            @SuppressWarnings("unchecked")
            List<Object[]> rows = q.getResultList();
            em.clear();
            if (!rows.isEmpty()) {
                Object[] r = rows.get(0);
                Cliente c = new Cliente();
                c.setId(((Number) r[0]).longValue());
                c.setCodCliente((String) r[1]);
                c.setNombreCliente((String) r[2]);
                out.put(par, c);
            }
        }

        em.flush(); em.clear();
        return out;
    }

    /** Resuelve el cliente de una fila usando (cod|nombre) o solo cod, consultando también la BD si hace falta. */
    private Cliente resolverClienteParaFila(RegistroFila rf, Map<String, Cliente> clientesPar, Map<String, Cliente> clientesPorCodigo) {
        String cod = rf.codCliente == null ? null : rf.codCliente.trim();
        String nom = rf.nombreCliente == null ? null : rf.nombreCliente.trim();

        if (!isBlank(cod) && !isBlank(nom)) {
            String key = cod.toUpperCase(Locale.ROOT) + "|" + nom.toUpperCase(Locale.ROOT);
            Cliente c = clientesPar.get(key);
            if (c != null) return c;
        }
        if (!isBlank(cod)) {
            String codeUpper = cod.toUpperCase(Locale.ROOT);
            Cliente c = clientesPorCodigo.get(codeUpper);
            if (c != null) return c;
            return clienteService.findByCodCliente(codeUpper).orElse(null);
        }
        return null;
    }

    private Optional<Sheet> getHojaBase(Workbook wb) {
        for (int i = 0; i < wb.getNumberOfSheets(); i++) {
            Sheet s = wb.getSheetAt(i);
            if ("BASE".equals(normalizar(s.getSheetName()))) return Optional.of(s);
        }
        return Optional.ofNullable(wb.getSheet(HOJA));
    }

    private List<String> leerEncabezados(Sheet sheet) {
        Row row = sheet.getRow(FILA_ENCAB);
        List<String> headers = new ArrayList<>();
        for (int c = COL_INI; c <= COL_FIN; c++) {
            headers.add(normalizar(getCellText(row, c)));
        }
        return headers;
    }

    private String getCellText(Row row, int colIndex) {
        Object raw = getCellRaw(row, colIndex);
        if (raw == null) return null;
        String s = String.valueOf(raw).trim();
        return s.isEmpty() ? null : s;
    }

    private Integer getCellInteger(Row row, int colIndex) {
        Object raw = getCellRaw(row, colIndex);
        if (raw == null) return null;
        try {
            if (raw instanceof Number) return ((Number) raw).intValue();
            String s = String.valueOf(raw).trim();
            if (s.isEmpty()) return null;
            return new java.math.BigDecimal(s).intValue();
        } catch (Exception e) {
            return null;
        }
    }

    private Double getCellDouble(Row row, int colIndex) {
        Object raw = getCellRaw(row, colIndex);
        if (raw == null) return null;
        try {
            if (raw instanceof Number) return ((Number) raw).doubleValue();
            String s = String.valueOf(raw).trim();
            if (s.isEmpty()) return null;
            s = s.replace(",", ".");
            return Double.valueOf(s);
        } catch (Exception e) {
            return null;
        }
    }

    private Object getCellRaw(Row row, int colIndex) {
        if (row == null) return null;
        Cell cell = row.getCell(colIndex, Row.MissingCellPolicy.RETURN_BLANK_AS_NULL);
        if (cell == null) return null;
        switch (cell.getCellType()) {
            case STRING:  return cell.getStringCellValue();
            case NUMERIC: return DateUtil.isCellDateFormatted(cell) ? cell.getDateCellValue() : cell.getNumericCellValue();
            case BOOLEAN: return cell.getBooleanCellValue();
            case FORMULA:
                try {
                    if (cell.getCachedFormulaResultType() == CellType.NUMERIC) {
                        return DateUtil.isCellDateFormatted(cell) ? cell.getDateCellValue() : cell.getNumericCellValue();
                    } else if (cell.getCachedFormulaResultType() == CellType.STRING) {
                        return cell.getStringCellValue();
                    }
                } catch (Exception ignored) {}
                return cell.toString();
            default: return null;
        }
    }

    private LocalDate getCellDate(Row row, int colIndex) {
        Object raw = getCellRaw(row, colIndex);
        if (raw == null) return null;
        try {
            if (raw instanceof Date) {
                return ((Date) raw).toInstant().atZone(ZoneId.systemDefault()).toLocalDate();
            }
            if (raw instanceof Number) {
                Date d = DateUtil.getJavaDate(((Number) raw).doubleValue());
                return d.toInstant().atZone(ZoneId.systemDefault()).toLocalDate();
            }
            String s = String.valueOf(raw).trim();
            if (s.isEmpty()) return null;
            int spaceIdx = s.indexOf(' ');
            if (spaceIdx > 0) s = s.substring(0, spaceIdx);
            int tIdx = s.indexOf('T');
            if (tIdx > 0) s = s.substring(0, tIdx);
            return tryParseLocalDate(s);
        } catch (Exception e) {
            return null;
        }
    }

    private LocalDate tryParseLocalDate(String s) {
        for (var f : DATE_FORMATS) {
            try { return LocalDate.parse(s, f); } catch (Exception ignore) {}
        }
        return null;
    }

    private static String normalizar(String s) {
        if (s == null) return null;
        return Normalizer.normalize(s.trim().replaceAll("\\s+", " "), Normalizer.Form.NFD)
                .replaceAll("\\p{InCombiningDiacriticalMarks}+", "")
                .toUpperCase(Locale.ROOT);
    }

    private static boolean isBlank(String s) { return s == null || s.trim().isEmpty(); }
    private static String safeTrim(String s) { return s == null ? null : s.trim(); }

    private static <T> List<List<T>> partitions(List<T> list, int size) {
        if (list.isEmpty()) return List.of(list);
        List<List<T>> out = new ArrayList<>((list.size() + size - 1) / size);
        for (int i = 0; i < list.size(); i += size) {
            out.add(list.subList(i, Math.min(i + size, list.size())));
        }
        return out;
    }

    // =========================
    //   BORRADO MASIVO 5000
    // =========================

    /** Elimina HASTA 5000 ventas según una selección explícita del front (claves). */
    public Map<String, Object> eliminarVentasSeleccionadas(List<KeyVenta> seleccion) {
        Map<String, Object> out = new LinkedHashMap<>();
        if (seleccion == null || seleccion.isEmpty()) {
            out.put("ok", true);
            out.put("eliminados", 0);
            out.put("mensaje", "No hay registros seleccionados.");
            return out;
        }
        int objetivo = Math.min(seleccion.size(), DELETE_UI_BATCH);

        int[] totalEliminados = new int[]{0};
        txTemplate.execute(status -> {
            List<KeyVenta> ventana = seleccion.subList(0, objetivo);
            for (List<KeyVenta> chunk : partitions(ventana, FILAS_POR_SENTENCIA)) {
                totalEliminados[0] += deleteChunkByValues(chunk);
                if (totalEliminados[0] >= objetivo) break;
            }
            return null;
        });

        out.put("ok", true);
        out.put("solicitados", seleccion.size());
        out.put("procesadosMaximo", objetivo);
        out.put("eliminados", totalEliminados[0]);
        out.put("mensaje", "Eliminación masiva por selección realizada en tandas internas (máx. 5000).");
        return out;
    }

    /** Borra un sublote usando tabla derivada VALUES y JOIN (sin cliente para mantener compatibilidad actual). */
    private int deleteChunkByValues(List<KeyVenta> chunk) {
        if (chunk == null || chunk.isEmpty()) return 0;

        int maxFilasSeguras = Math.min(chunk.size(), SQLSERVER_PARAM_LIMIT / PARAMS_POR_FILA);
        List<KeyVenta> safe = chunk.subList(0, maxFilasSeguras);

        StringBuilder sb = new StringBuilder();
        sb.append("DELETE v ")
          .append("FROM Venta v ")
          .append("JOIN (VALUES ");

        for (int i = 0; i < safe.size(); i++) {
            if (i > 0) sb.append(",");
            sb.append("(?, ?, ?, ?)");
        }
        sb.append(") AS T(anio, mes, codBarra, codPdv) ")
          .append("ON v.anio = T.anio ")
          .append("AND v.mes = T.mes ")
          .append("AND v.codBarra = T.codBarra ")
          .append("AND ( (v.codPdv = T.codPdv) OR (v.codPdv IS NULL AND T.codPdv IS NULL) )");

        Query q = em.createNativeQuery(sb.toString());

        int idx = 1;
        for (KeyVenta k : safe) {
            q.setParameter(idx++, k.anio);
            q.setParameter(idx++, k.mes);
            q.setParameter(idx++, k.codBarra);
            if (k.codPdv == null || k.codPdv.trim().isEmpty()) {
                q.setParameter(idx++, null);
            } else {
                q.setParameter(idx++, k.codPdv);
            }
        }
        int afectadas = q.executeUpdate();
        em.clear();
        return afectadas;
    }

    /** Elimina por filtros (año/mes/marca/pdv) en tandas de TOP (5000). */
    public Map<String, Object> eliminarPorFiltros(
            Integer anio, Integer mes, String marca, String codPdv,
            Integer maxTotal
    ) {
        Map<String, Object> out = new LinkedHashMap<>();
        int total = 0;
        boolean seguir = true;

        while (seguir) {
            StringBuilder where = new StringBuilder(" WHERE 1=1 ");
            List<Object> params = new ArrayList<>();

            if (anio != null) { where.append(" AND v.anio = ? "); params.add(anio); }
            if (mes  != null)  { where.append(" AND v.mes  = ? "); params.add(mes); }
            if (marca != null && !marca.isBlank()) {
                where.append(" AND v.marca = ? "); params.add(marca.trim());
            }
            if (codPdv != null && !codPdv.isBlank()) {
                where.append(" AND v.codPdv = ? "); params.add(codPdv.trim());
            }

            String sql = "DELETE TOP (" + DELETE_UI_BATCH + ") FROM Venta v " + where;
            Query q = em.createNativeQuery(sql);
            for (int i = 0; i < params.size(); i++) q.setParameter(i + 1, params.get(i));

            int afectadas = txTemplate.execute(status -> {
                int n = q.executeUpdate();
                em.clear();
                return n;
            });

            total += afectadas;
            boolean alcanzadoTope = (maxTotal != null && total >= maxTotal);
            seguir = (afectadas == DELETE_UI_BATCH) && !alcanzadoTope;
        }

        out.put("ok", true);
        out.put("eliminados", total);
        out.put("mensaje", "Eliminación por filtros completada en tandas de 5000.");
        return out;
    }

    // =========================
    //   Tipos auxiliares
    // =========================

    public static final class KeyVenta {
        final int anio;
        final int mes;
        final String codBarra;
        final String codPdv;

        public KeyVenta(int anio, int mes, String codBarra, String codPdv) {
            this.anio = anio;
            this.mes = mes;
            this.codBarra = codBarra;
            this.codPdv = codPdv;
        }

        @Override public boolean equals(Object o) {
            if (this == o) return true;
            if (!(o instanceof KeyVenta)) return false;
            KeyVenta k = (KeyVenta) o;
            return anio == k.anio &&
                    mes == k.mes &&
                    Objects.equals(codBarra, k.codBarra) &&
                    Objects.equals(codPdv, k.codPdv);
        }

        @Override public int hashCode() {
            return Objects.hash(anio, mes, codBarra, codPdv);
        }
    }

    private static final class RegistroFila {
        final int excelFila;
        final String codCliente;
        final String nombreCliente;
        final LocalDate fecha;
        final String codBarra;
        final String descripcion;
        final String marca;
        final String codPdv;
        final String ciudad;
        final String pdv;
        final Integer ventaUnidades;
        final Double  ventaUSD;
        final Integer stockUnidades;

        RegistroFila(int excelFila, String codCliente, String nombreCliente, LocalDate fecha,
                     String codBarra, String descripcion, String marca, String codPdv,
                     String ciudad, String pdv, Integer ventaUnidades, Double ventaUSD,
                     Integer stockUnidades) {
            this.excelFila = excelFila;
            this.codCliente = codCliente;
            this.nombreCliente = nombreCliente;
            this.fecha = fecha;
            this.codBarra = codBarra;
            this.descripcion = descripcion;
            this.marca = marca;
            this.codPdv = codPdv;
            this.ciudad = ciudad;
            this.pdv = pdv;
            this.ventaUnidades = ventaUnidades;
            this.ventaUSD = ventaUSD;
            this.stockUnidades = stockUnidades;
        }
    }
}
