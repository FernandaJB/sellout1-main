package com.manamer.backend.business.sellout.service;

import com.google.common.net.HttpHeaders;
import com.manamer.backend.business.sellout.models.Cliente;
import com.manamer.backend.business.sellout.models.Producto;
import com.manamer.backend.business.sellout.models.Venta;
import com.manamer.backend.business.sellout.repositories.VentaRepository;
import jakarta.persistence.EntityManager;
import jakarta.persistence.Query;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.core.io.InputStreamResource;
import org.springframework.core.io.Resource;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.io.BufferedWriter;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.*;
import java.util.stream.Collectors;

@Service
public class FybecaVentaService {

    // ====== Config ======
    // CodCliente por defecto (correcto):
    private static final String DEFAULT_COD_CLIENTE = "MZCL-000014";
    private static final ZoneId ZONE = ZoneId.systemDefault();
    private static final String CARPETA_CODIGOS = "/creacion-codigos";

    private final VentaRepository ventaRepository;
    private final EntityManager entityManager;
    private final ClienteService clienteService;

    @Autowired
    public FybecaVentaService(VentaRepository ventaRepository, EntityManager entityManager, ClienteService clienteService) {
        this.ventaRepository = ventaRepository;
        this.entityManager = entityManager;
        this.clienteService = clienteService;
    }

    // ====== Helpers ======
    private Cliente getClienteOrThrow(String codCliente) {
        return clienteService.findByCodCliente(codCliente)
                .orElseThrow(() -> new IllegalStateException("Cliente no existe: " + codCliente));
    }

    // ====== Consultas CRUD ======

    /** Genérico: obtener todas las ventas por codCliente */
    public List<Venta> obtenerTodasLasVentasPorCodCliente(String codCliente) {
        String jpql = "SELECT v FROM Venta v WHERE v.cliente.codCliente = :cod";
        return entityManager.createQuery(jpql, Venta.class)
                .setParameter("cod", codCliente)
                .getResultList();
    }

    /** Wrapper: mantiene compatibilidad para el default (MZCL-000014) */
    public List<Venta> obtenerTodasLasVentasFybeca() {
        return obtenerTodasLasVentasPorCodCliente(DEFAULT_COD_CLIENTE);
    }

    /** Genérico: obtener una venta por id y codCliente */
    public Optional<Venta> obtenerVentaPorIdYCodCliente(Long id, String codCliente) {
        String jpql = "SELECT v FROM Venta v WHERE v.id = :id AND v.cliente.codCliente = :cod";
        List<Venta> res = entityManager.createQuery(jpql, Venta.class)
                .setParameter("id", id)
                .setParameter("cod", codCliente)
                .getResultList();
        return res.isEmpty() ? Optional.empty() : Optional.of(res.get(0));
    }

    /** Wrapper: compatibilidad para el default (MZCL-000014) */
    public Optional<Venta> obtenerVentaFybecaPorId(Long id) {
        return obtenerVentaPorIdYCodCliente(id, DEFAULT_COD_CLIENTE);
    }

    /** Eliminar una venta por ID (sin depender del cliente) */
    public boolean eliminarVenta(Long id) {
        return ventaRepository.findById(id).map(v -> {
            ventaRepository.delete(v);
            return true;
        }).orElse(false);
    }

    /** Eliminar ventas masivo por IDs (sin depender del cliente) */
    public boolean eliminarVentas(List<Long> ids) {
        try {
            List<Venta> ventas = ventaRepository.findAllById(ids);
            ventaRepository.deleteAll(ventas);
            return true;
        } catch (Exception e) {
            return false;
        }
    }

    // ====== Update / Upsert ======

    /** Genérico: actualizar por ID y codCliente (forzando cliente con ID real) */
    @Transactional
    public Venta actualizarVentaPorCodCliente(Long id, String codCliente, Venta nuevaVenta) {
        Cliente cliente = getClienteOrThrow(codCliente);
        nuevaVenta.setCliente(cliente); // garantiza ID correcto
        return ventaRepository.findById(id).map(v -> {
            v.setAnio(nuevaVenta.getAnio());
            v.setMes(nuevaVenta.getMes());
            v.setDia(nuevaVenta.getDia());
            v.setMarca(nuevaVenta.getMarca());
            v.setVentaDolares(nuevaVenta.getVentaDolares());
            v.setVentaUnidad(nuevaVenta.getVentaUnidad());
            v.setNombreProducto(nuevaVenta.getNombreProducto());
            v.setCodigoSap(nuevaVenta.getCodigoSap());
            v.setCodBarra(nuevaVenta.getCodBarra());
            v.setCodPdv(nuevaVenta.getCodPdv());
            v.setDescripcion(nuevaVenta.getDescripcion());
            v.setPdv(nuevaVenta.getPdv());
            v.setStockDolares(nuevaVenta.getStockDolares());
            v.setStockUnidades(nuevaVenta.getStockUnidades());
            v.setCiudad(nuevaVenta.getCiudad());
            v.setCliente(cliente);
            v.setProducto(nuevaVenta.getProducto());
            return ventaRepository.save(v);
        }).orElseThrow(() -> new RuntimeException("Venta no encontrada con el ID: " + id));
    }

    /** Wrapper: actualizar usando default (MZCL-000014) */
    @Transactional
    public Venta actualizarVentaFybeca(Long id, Venta nuevaVenta) {
        return actualizarVentaPorCodCliente(id, DEFAULT_COD_CLIENTE, nuevaVenta);
    }

    /** NUEVO: Upsert recibiendo Cliente (garantiza cliente_id correcto) */
    @Transactional
    public void guardarOActualizarVenta(Cliente cliente, Venta nuevaVenta) {
        nuevaVenta.setCliente(cliente); // ID real
        String codBarra = (nuevaVenta.getCodBarra() == null) ? null : nuevaVenta.getCodBarra().trim();
        String codPdv   = (nuevaVenta.getCodPdv()   == null) ? null : nuevaVenta.getCodPdv().trim();
        nuevaVenta.setCodBarra(codBarra);
        nuevaVenta.setCodPdv(codPdv);

        Optional<Venta> existente = ventaRepository
                .findByClienteIdAndAnioAndMesAndDiaAndCodBarraAndCodPdv(
                        cliente.getId(),
                        nuevaVenta.getAnio(),
                        nuevaVenta.getMes(),
                        nuevaVenta.getDia(),
                        nuevaVenta.getCodBarra(),
                        nuevaVenta.getCodPdv()
                );

        if (existente.isPresent()) {
            Venta v = existente.get();
            v.setVentaDolares(nuevaVenta.getVentaDolares());
            v.setVentaUnidad(nuevaVenta.getVentaUnidad());
            v.setStockDolares(nuevaVenta.getStockDolares());
            v.setStockUnidades(nuevaVenta.getStockUnidades());
            v.setPdv(nuevaVenta.getPdv());
            v.setCiudad(nuevaVenta.getCiudad());
            v.setMarca(nuevaVenta.getMarca());
            v.setNombreProducto(nuevaVenta.getNombreProducto());
            v.setCodigoSap(nuevaVenta.getCodigoSap());
            v.setDescripcion(nuevaVenta.getDescripcion());
            v.setProducto(nuevaVenta.getProducto());
            v.setCliente(cliente); // reafirma cliente/id
            ventaRepository.save(v);
        } else {
            ventaRepository.save(nuevaVenta);
        }
    }

    /** Genérico: Upsert recibiendo codCliente */
    @Transactional
    public void guardarOActualizarVentaPorCodCliente(String codCliente, Venta nuevaVenta) {
        Cliente cliente = getClienteOrThrow(codCliente);
        guardarOActualizarVenta(cliente, nuevaVenta);
    }

    /** Wrapper: upsert usando default (MZCL-000014) */
    @Transactional
    public void guardarOActualizarVentaFybeca(Venta nuevaVenta) {
        guardarOActualizarVentaPorCodCliente(DEFAULT_COD_CLIENTE, nuevaVenta);
    }

    // ====== Carga de datos de producto (enriquecimiento por fila) ======

    /** NUEVO: Enriquecer usando Cliente (NO reemplaza el cliente de la venta) */
    public boolean cargarDatosDeProducto(Cliente cliente, Venta venta, Set<String> codigosNoEncontrados) {
        String codigo = venta.getCodBarra();
        if (codigo == null || codigo.trim().isEmpty()) return false;
        codigo = codigo.trim();

        try {
            String sql = """
                SELECT TOP 1
                    p.id            AS IdProducto,
                    p.cod_Item      AS CodItem,
                    p.cod_Barra_Sap AS CodBarraSap,
                    sp.CodProd      AS CodProd,
                    sp.CodBarra     AS CodBarra,
                    sp.Descripcion  AS Descripcion,
                    sp.Marca        AS Marca
                FROM SELLOUT.dbo.producto p
                LEFT JOIN SAPHANA..CG3_360CORP.SAP_Prod sp ON sp.CodBarra = p.cod_Barra_Sap
                WHERE (p.cod_Item = :codigo OR p.cod_Barra_Sap = :codigo)
            """;
            Query q = entityManager.createNativeQuery(sql);
            q.setParameter("codigo", codigo);

            @SuppressWarnings("unchecked")
            List<Object[]> rows = q.getResultList();
            if (rows.isEmpty()) {
                if (codigosNoEncontrados != null) codigosNoEncontrados.add(codigo);
                return false;
            }

            // Mantiene el cliente con ID real
            venta.setCliente(cliente);

            Object[] r = rows.get(0);
            Producto p = new Producto();
            p.setId(((Number) r[0]).longValue());
            p.setCodItem((String) r[1]);
            p.setCodBarraSap((String) r[2]);
            venta.setProducto(p);

            venta.setCodigoSap((String) r[3]);
            venta.setCodBarra(((String) r[4]).trim());
            venta.setDescripcion((String) r[5]);
            venta.setNombreProducto((String) r[5]);
            venta.setMarca((String) r[6]);

            return true;
        } catch (Exception ex) {
            if (codigosNoEncontrados != null) codigosNoEncontrados.add(codigo);
            return false;
        }
    }

    /** Wrapper: sigue aceptando codCliente */
    public boolean cargarDatosDeProducto(String codCliente, Venta venta, Set<String> codigosNoEncontrados) {
        Cliente cliente = getClienteOrThrow(codCliente);
        return cargarDatosDeProducto(cliente, venta, codigosNoEncontrados);
    }

    // ====== Archivo de incidencias (códigos no encontrados) ======

    private void guardarCodigoNoEncontradoLocal(String cod) {
        try (BufferedWriter w = Files.newBufferedWriter(
                Paths.get(CARPETA_CODIGOS, "codigos_no_encontrados.txt"),
                StandardOpenOption.CREATE, StandardOpenOption.APPEND)) {
            w.write(cod);
            w.newLine();
        } catch (IOException ignored) {}
    }

    public ResponseEntity<Resource> obtenerArchivoCodigosNoEncontrados(List<String> codigosNoEncontrados) {
        List<String> depurados = (codigosNoEncontrados == null ? List.<String>of() : codigosNoEncontrados).stream()
                .filter(Objects::nonNull)
                .map(String::trim)
                .filter(s -> !s.isEmpty())
                .distinct()
                .sorted()
                .collect(Collectors.toList());

        boolean empty = depurados.isEmpty();
        StringBuilder sb = new StringBuilder();
        sb.append("CODIGOS_NO_ENCONTRADOS").append(System.lineSeparator());
        if (empty) {
            sb.append("Sin códigos no encontrados.").append(System.lineSeparator());
        } else {
            depurados.forEach(c -> sb.append(c).append(System.lineSeparator()));
        }

        byte[] bytes = sb.toString().getBytes(StandardCharsets.UTF_8);
        InputStreamResource resource = new InputStreamResource(new ByteArrayInputStream(bytes));
        String filename = "codigos_no_encontrados_" +
                LocalDateTime.now(ZONE).format(DateTimeFormatter.ofPattern("yyyyMMdd_HHmmss")) + ".txt";

        return ResponseEntity.ok()
                .header(HttpHeaders.CONTENT_DISPOSITION, "attachment; filename=" + filename)
                .contentType(MediaType.TEXT_PLAIN)
                .contentLength(bytes.length)
                .body(resource);
    }

    // ====== Catálogos ======

    /** Genérico: marcas por codCliente */
    public List<String> obtenerMarcasDisponibles(String codCliente) {
        String jpql = "SELECT DISTINCT v.marca FROM Venta v WHERE v.marca IS NOT NULL AND v.cliente.codCliente = :cod";
        return entityManager.createQuery(jpql, String.class)
                .setParameter("cod", codCliente)
                .getResultList();
    }

    /** Wrapper: default (MZCL-000014) */
    public List<String> obtenerMarcasDisponiblesFybeca() {
        return obtenerMarcasDisponibles(DEFAULT_COD_CLIENTE);
    }

    /** Genérico: años por codCliente */
    public List<Integer> obtenerAniosDisponibles(String codCliente) {
        String jpql = "SELECT DISTINCT v.anio FROM Venta v WHERE v.cliente.codCliente = :cod ORDER BY v.anio DESC";
        return entityManager.createQuery(jpql, Integer.class)
                .setParameter("cod", codCliente)
                .getResultList();
    }

    /** Wrapper: default (MZCL-000014) */
    public List<Integer> obtenerAniosDisponiblesFybeca() {
        return obtenerAniosDisponibles(DEFAULT_COD_CLIENTE);
    }

    /** Genérico: meses por codCliente (y opcional año) */
    public List<Integer> obtenerMesesDisponibles(String codCliente, Integer anio) {
        if (anio == null) {
            String jpql = "SELECT DISTINCT v.mes FROM Venta v WHERE v.cliente.codCliente = :cod ORDER BY v.mes";
            return entityManager.createQuery(jpql, Integer.class)
                    .setParameter("cod", codCliente)
                    .getResultList();
        }
        String jpql = "SELECT DISTINCT v.mes FROM Venta v WHERE v.anio = :anio AND v.cliente.codCliente = :cod ORDER BY v.mes";
        return entityManager.createQuery(jpql, Integer.class)
                .setParameter("anio", anio)
                .setParameter("cod", codCliente)
                .getResultList();
    }

    /** Wrapper: default (MZCL-000014) */
    public List<Integer> obtenerMesesDisponiblesFybeca(Integer anio) {
        return obtenerMesesDisponibles(DEFAULT_COD_CLIENTE, anio);
    }

    // ====== Reporte (opcional) ======

    /** Genérico: reporte crudo por codCliente */
    public List<Object[]> obtenerReporteVentasCrudo(String codCliente) {
        String sql = """
            WITH VentasMensuales AS (
                SELECT v.cod_Pdv, v.pdv,
                       FORMAT(v.anio, '0000') + '-' + FORMAT(v.mes, '00') AS periodo,
                       SUM(CAST(v.venta_Unidad AS INT)) AS total_unidades
                FROM [SELLOUT].[dbo].[venta] v
                JOIN [SELLOUT].[dbo].[cliente] c ON c.id = v.cliente_id
                WHERE c.cod_Cliente = :codCliente
                GROUP BY v.cod_Pdv, v.pdv, v.anio, v.mes
            ),
            PromedioUnidades AS (
                SELECT cod_Pdv, AVG(total_unidades) AS promedio_mensual
                FROM VentasMensuales
                WHERE periodo IN (
                    SELECT DISTINCT TOP 3 periodo FROM VentasMensuales ORDER BY periodo DESC
                )
                GROUP BY cod_Pdv
            )
            SELECT vm.cod_Pdv, vm.pdv, tm.ciudad,
                   tm.tipo_Display_Essence, tm.tipo_Mueble_Display_Catrice,
                   COALESCE(SUM(vm.total_unidades), 0) AS total_unidades_mes,
                   COALESCE(pu.promedio_mensual, 0) AS promedio_mes,
                   ROUND(COALESCE(pu.promedio_mensual, 0) / 30, 2) AS unidad_diaria
            FROM VentasMensuales vm
            INNER JOIN [SELLOUT].[dbo].[tipo_mueble] tm ON vm.cod_Pdv = tm.cod_Pdv
            LEFT JOIN PromedioUnidades pu ON vm.cod_Pdv = pu.cod_Pdv
            GROUP BY vm.cod_Pdv, vm.pdv, tm.ciudad, tm.tipo_Display_Essence, tm.tipo_Mueble_Display_Catrice, pu.promedio_mensual;
        """;
        Query q = entityManager.createNativeQuery(sql);
        q.setParameter("codCliente", codCliente);
        @SuppressWarnings("unchecked")
        List<Object[]> res = q.getResultList();
        return res;
    }

    /** Wrapper: default (MZCL-000014) */
    public List<Object[]> obtenerReporteVentasFybecaCrudo() {
        return obtenerReporteVentasCrudo(DEFAULT_COD_CLIENTE);
    }
}
