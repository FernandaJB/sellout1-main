package com.manamer.backend.business.sellout.service;

import java.io.IOException;
import java.io.InputStream;
import java.util.*;
import java.util.stream.Collectors;

import org.apache.poi.ss.usermodel.*;
import org.apache.poi.xssf.usermodel.XSSFWorkbook;
import org.springframework.beans.BeanUtils;
import org.springframework.beans.BeanWrapper;
import org.springframework.beans.BeanWrapperImpl;
import org.springframework.dao.EmptyResultDataAccessException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.multipart.MultipartFile;

import com.manamer.backend.business.sellout.models.Producto;
import com.manamer.backend.business.sellout.repositories.ProductoRepository;

import jakarta.persistence.EntityManager;
import jakarta.persistence.PersistenceContext;
import lombok.RequiredArgsConstructor;

@Service
@RequiredArgsConstructor
public class ProductoService {

    private final ProductoRepository repository;

    @PersistenceContext
    private EntityManager em;

    // ======== Lecturas: readOnly para mejores tiempos/menor overhead ========
    @Transactional(readOnly = true)
    public Optional<Producto> findById(Long id) {
        return repository.findById(id);
    }

    // Si puedes, usa Pageable para no traer todo
    @Transactional(readOnly = true)
    public List<Producto> getAllProductos() {
        return repository.findAll();
    }

    // ======== Escrituras ========
    @Transactional
    public Producto saveOrUpdate(Producto producto) {
        return repository.save(producto);
    }

    @Transactional
    public void deleteProductoById(Long id) {
        try {
            repository.deleteById(id);
        } catch (EmptyResultDataAccessException ex) {
            throw new IllegalArgumentException("El producto con el ID especificado no existe.");
        }
    }

    @Transactional
    public DeleteProductosResult deleteProductosSafe(List<Long> ids) {
        if (ids == null || ids.isEmpty()) {
            throw new IllegalArgumentException("No se proporcionaron IDs para eliminar.");
        }

        // 1) ¿Cuáles están referenciados?
        List<Long> referenced = repository.findReferencedProductoIdsInVentas(ids);
        Set<Long> referencedSet = new HashSet<>(referenced);

        // 2) Borrables = ids - referenciados
        List<Long> deletables = ids.stream()
                .filter(id -> !referencedSet.contains(id))
                .toList();

        // 3) Borra en lote solo los borrables
        if (!deletables.isEmpty()) {
            repository.deleteAllByIdInBatch(deletables);
        }

        // 4) Info para UI de los bloqueados
        List<ProductoRepository.ProductoMinView> bloqueadosInfo =
                referencedSet.isEmpty() ? List.of() : repository.findAllByIdIn(referencedSet);

        // 5) Arma mensaje amigable
        String msg = buildMessage(deletables.size(), referencedSet.size(), bloqueadosInfo);

        return new DeleteProductosResult(deletables, referenced, bloqueadosInfo, msg);
    }

    private String buildMessage(int eliminados, int bloqueados,
                                List<ProductoRepository.ProductoMinView> info) {
        String base = "Eliminados: " + eliminados;
        if (bloqueados == 0) return base;

        String detalle = info.stream()
                .map(p -> String.format("ID %d (Item: %s, Barra: %s)",
                        p.getId(), nn(p.getCodItem()), nn(p.getCodBarraSap())))
                .collect(java.util.stream.Collectors.joining("; "));

        return base + " | No eliminados por ventas asociadas: " + bloqueados + " → " + detalle;
    }

    private String nn(String s) { return s == null ? "-" : s; }

    // DTO de salida
    @lombok.Value
    public static class DeleteProductosResult {
        List<Long> eliminados;
        List<Long> bloqueados;
        List<ProductoRepository.ProductoMinView> bloqueadosInfo;
        String message;
    }
    
    @Transactional
    public void deleteProductos(List<Long> ids) {
        if (ids == null || ids.isEmpty()) {
            throw new IllegalArgumentException("No se proporcionaron IDs para eliminar.");
        }

        // 1) ¿Cuáles están referenciados?
        List<Long> referenced = repository.findReferencedProductoIdsInVentas(ids);
        Set<Long> referencedSet = new java.util.HashSet<>(referenced);

        // 2) Deletables = ids - referenced
        List<Long> deletables = ids.stream()
                .filter(id -> !referencedSet.contains(id))
                .toList();

        // 3) Borra en lote solo los deletables
        if (!deletables.isEmpty()) {
            repository.deleteAllByIdInBatch(deletables);
        }

        // 4) Si hubo bloqueados, informa con claridad
        if (!referencedSet.isEmpty()) {
            throw new org.springframework.dao.DataIntegrityViolationException(
                "No se pudieron eliminar " + referencedSet.size() + " producto(s) porque tienen ventas asociadas: " + referencedSet
            );
        }
    }


    /**
     * Carga productos desde XLSX:
     * - DataFormatter reutilizado
     * - Normaliza/valida
     * - Dedup interna por (codItem|codBarraSap) -> "última fila gana"
     * - Upsert en BD en lotes
     */
    @Transactional
    public String cargarProductosDesdeArchivo(MultipartFile file) {
        if (file.isEmpty()) return "El archivo está vacío.";

        try (InputStream inputStream = file.getInputStream();
             Workbook workbook = new XSSFWorkbook(inputStream)) {

            Sheet sheet = workbook.getSheetAt(0);
            DataFormatter formatter = new DataFormatter();

            // Deduplicación con LinkedHashMap (mantiene orden de llegada)
            Map<String, Producto> dedup = new LinkedHashMap<>(Math.max(16, sheet.getLastRowNum() + 1));

            for (Row row : sheet) {
                if (row == null) continue;
                if (row.getRowNum() == 0) continue; // encabezado

                String codItem  = normalizar(formatter.formatCellValue(getCell(row, 0)));
                String codBarra = normalizar(formatter.formatCellValue(getCell(row, 1)));

                if (isBlank(codItem) || isBlank(codBarra)) continue;

                Producto p = new Producto();
                p.setCodItem(codItem);
                p.setCodBarraSap(codBarra);

                // TODO: mapear más columnas si aplica
                // p.setNombre(normalizar(formatter.formatCellValue(getCell(row, 2))));
                // p.setMarca(normalizar(formatter.formatCellValue(getCell(row, 3))));
                // ...

                dedup.put(key(codItem, codBarra), p); // última ocurrencia gana
            }

            upsertAll(new ArrayList<>(dedup.values()));
            return "Productos cargados correctamente (sin duplicados y con reemplazo).";

        } catch (IOException e) {
            return "Error al cargar el archivo: " + e.getMessage();
        }
    }

    /**
     * Upsert por (codItem, codBarraSap) con actualización de campos no nulos.
     * Optimizado:
     *   - Precarga existentes SOLO por los codItem involucrados (evita findAll()).
     *   - Divide en lotes para saveAll + flush + clear (memoria estable y mejor throughput).
     */
    @Transactional
    public void upsertAll(List<Producto> productos) {
        if (productos == null || productos.isEmpty()) return;

        // Limpiar entradas inválidas y deduplicar por clave para esta corrida
        Map<String, Producto> incomingByKey = new LinkedHashMap<>(productos.size());
        Set<String> codItems = new LinkedHashSet<>();
        for (Producto p : productos) {
            if (p == null) continue;
            String codItem = normalizar(p.getCodItem());
            String codBarra = normalizar(p.getCodBarraSap());
            if (isBlank(codItem) || isBlank(codBarra)) continue;

            String k = key(codItem, codBarra);
            p.setCodItem(codItem);
            p.setCodBarraSap(codBarra);
            incomingByKey.put(k, p);
            codItems.add(codItem);
        }
        if (incomingByKey.isEmpty()) return;

        // Precarga EXISTENTES por codItem (reduce drásticamente I/O vs findAll())
        List<Producto> existentes = repository.findAllByCodItemIn(codItems);

        Map<String, Producto> existingByKey = new HashMap<>(existentes.size() * 2);
        for (Producto ex : existentes) {
            existingByKey.put(key(ex.getCodItem(), ex.getCodBarraSap()), ex);
        }

        List<Producto> toUpdate = new ArrayList<>();
        List<Producto> toInsert = new ArrayList<>();

        for (Map.Entry<String, Producto> e : incomingByKey.entrySet()) {
            String k = e.getKey();
            Producto incoming = e.getValue();
            Producto ex = existingByKey.get(k);
            if (ex != null) {
                mergeProducto(ex, incoming);   // copia solo NO nulos (sin tocar id/codItem/codBarraSap)
                toUpdate.add(ex);
            } else {
                toInsert.add(incoming);
            }
        }

        // Persistencia en lotes (ajusta el tamaño a tu pool/conexión)
        final int BATCH = 1000;

        if (!toInsert.isEmpty()) {
            persistInBatches(toInsert, BATCH);
        }
        if (!toUpdate.isEmpty()) {
            persistInBatches(toUpdate, BATCH);
        }
    }

    private void persistInBatches(List<Producto> items, int batchSize) {
        // saveAll ya aprovecha el batching de Hibernate si está configurado.
        // Aun así, hacemos flush/clear periódicos para mantener memoria estable.
        for (int i = 0; i < items.size(); i += batchSize) {
            int end = Math.min(i + batchSize, items.size());
            repository.saveAll(items.subList(i, end));
            repository.flush();  // fuerza envío a la BD
            em.clear();          // evita crecimiento del 1er level cache
        }
    }

    // ---------- utilidades privadas ----------
    private static Cell getCell(Row row, int idx) {
        return row == null ? null : row.getCell(idx, Row.MissingCellPolicy.RETURN_BLANK_AS_NULL);
    }

    private static String normalizar(String s) {
        if (s == null) return null;
        s = s.trim();
        return s.isEmpty() ? null : s;
    }

    private static boolean isBlank(String s) {
        return s == null || s.isBlank();
    }

    private static String key(String codItem, String codBarraSap) {
        return (codItem == null ? "" : codItem) + "|" + (codBarraSap == null ? "" : codBarraSap);
    }

    /**
     * Copia propiedades NO nulas de source sobre target.
     * No toca: id, codItem, codBarraSap.
     */
    private static void mergeProducto(Producto target, Producto source) {
        if (target == null || source == null) return;
        String[] ignore = {"id", "codItem", "codBarraSap"};
        String[] nullProps = getNullPropertyNames(source);
        String[] toIgnore = concat(ignore, nullProps);
        BeanUtils.copyProperties(source, target, toIgnore);
    }

    private static String[] getNullPropertyNames(Object source) {
        final BeanWrapper src = new BeanWrapperImpl(source);
        var pds = src.getPropertyDescriptors();
        Set<String> emptyNames = new LinkedHashSet<>();
        for (var pd : pds) {
            String name = pd.getName();
            if ("class".equals(name)) continue;
            Object v = src.getPropertyValue(name);
            if (v == null) emptyNames.add(name);
        }
        return emptyNames.toArray(new String[0]);
    }

    private static String[] concat(String[] a, String[] b) {
        String[] r = new String[a.length + b.length];
        System.arraycopy(a, 0, r, 0, a.length);
        System.arraycopy(b, 0, r, a.length, b.length);
        return r;
    }
}
