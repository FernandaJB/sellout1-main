package com.manamer.backend.business.sellout.service;

import java.io.InputStream;
import java.util.*;
import java.util.stream.Collectors;

import jakarta.transaction.Transactional;
import org.apache.poi.ss.usermodel.*;
import org.apache.poi.xssf.usermodel.XSSFWorkbook;
import org.springframework.stereotype.Service;
import org.springframework.web.multipart.MultipartFile;

import com.manamer.backend.business.sellout.models.Cliente;
import com.manamer.backend.business.sellout.repositories.ClienteRepository;

@Service
@Transactional
public class ClienteService {

    private final ClienteRepository repository;

    public ClienteService(ClienteRepository repository) {
        this.repository = repository;
    }

    // ===== CRUD =====
    public Optional<Cliente> findById(Long id) { return repository.findById(id); }

    public Cliente saveOrUpdate(Cliente cliente) { return repository.save(cliente); }

    public List<Cliente> getAllClientes() { return repository.findAll(); }

    public Optional<Cliente> getClienteById(Long id) { return repository.findById(id); }

    public void deleteCliente(Long id) { repository.deleteById(id); }

    public Map<String, Object> uploadClientesFromExcel(MultipartFile file) {
        Map<String, Object> out = new LinkedHashMap<>();
        List<Map<String, Object>> errors = new ArrayList<>();
        List<Map<String, Object>> warnings = new ArrayList<>();
        int inserted = 0; // ya no “updated”, porque si el par existe, NO tocamos nada
        int updated = 0;

        if (file == null || file.isEmpty()) {
            out.put("error", "Archivo vacío o no enviado.");
            return out;
        }

        try (InputStream is = file.getInputStream(); Workbook wb = new XSSFWorkbook(is)) {
            Sheet sheet = wb.getSheetAt(0);
            if (sheet == null) {
                out.put("error", "La primera hoja del Excel está vacía.");
                return out;
            }

            Row header = sheet.getRow(0);
            Map<String, Integer> headerIndex = readHeaderMap(header);
            if (headerIndex.isEmpty()) {
                out.put("error", "No se detectaron encabezados en la fila 1.");
                return out;
            }

            Map<String, String> aliases = Map.of(
                "codcliente", "codCliente",
                "codigo cliente", "codCliente",
                "código cliente", "codCliente",
                "nombrecliente", "nombreCliente",
                "nombre cliente", "nombreCliente",
                "ciudad", "ciudad",
                "codigoproveedor", "codigoProveedor",
                "código proveedor", "codigoProveedor",
                "codigo proveedor", "codigoProveedor"
            );

            Integer colCod  = findCol(headerIndex, aliases, "codCliente");
            Integer colNom  = findCol(headerIndex, aliases, "nombreCliente");
            Integer colCiu  = findCol(headerIndex, aliases, "ciudad");
            Integer colProv = findCol(headerIndex, aliases, "codigoProveedor");

            if (colCod == null || colNom == null) {
                out.put("error", "Faltan columnas requeridas: 'codCliente' y/o 'nombreCliente'.");
                return out;
            }

            DataFormatter fmt = new DataFormatter();

            // 1) Cache de pares existentes en BD (NORMALIZADOS): COD|NOMBRE
            Set<String> paresExistentes = repository.findAll().stream()
                .filter(c -> c.getCodCliente() != null && c.getNombreCliente() != null)
                .map(c -> pairKey(c.getCodCliente(), c.getNombreCliente()))
                .collect(Collectors.toCollection(LinkedHashSet::new));

            // 2) Control de duplicados dentro del mismo archivo (para no intentar dos veces)
            Set<String> paresVistosEnArchivo = new HashSet<>();

            int last = sheet.getLastRowNum();
            for (int r = 1; r <= last; r++) {
                Row row = sheet.getRow(r);
                if (row == null) continue;

                String codClienteRaw   = clean(fmt.formatCellValue(row.getCell(colCod)));
                String nombreCliente   = clean(fmt.formatCellValue(row.getCell(colNom)));
                String ciudad          = (colCiu  != null) ? clean(fmt.formatCellValue(row.getCell(colCiu)))  : null;
                String codigoProveedor = (colProv != null) ? clean(fmt.formatCellValue(row.getCell(colProv))) : null;

                if (isBlank(codClienteRaw) && isBlank(nombreCliente)) {
                    continue; // fila vacía
                }
                if (isBlank(codClienteRaw)) {
                    errors.add(err(r + 1, "codCliente vacío."));
                    continue;
                }
                if (isBlank(nombreCliente)) {
                    errors.add(err(r + 1, "nombreCliente vacío."));
                    continue;
                }

                // CLAVE de decisión = PAR normalizado (ignora mayúsculas, tildes y espacios extra)
                String par = pairKey(codClienteRaw, nombreCliente);

                // Si el par YA existe en BD -> NO crear, NO actualizar
                if (paresExistentes.contains(par)) {
                    warnings.add(warn(r + 1, "Par (codCliente + nombreCliente) ya existe. Fila omitida."));
                    continue;
                }

                // Si el par ya apareció en este mismo archivo -> omitir fila duplicada
                if (!paresVistosEnArchivo.add(par)) {
                    warnings.add(warn(r + 1, "Par repetido en el archivo. Fila omitida."));
                    continue;
                }

                // >>> En este punto el PAR NO existe: crear SIEMPRE un NUEVO cliente,
                //     aunque exista el mismo código con OTRO nombre.
                Cliente nuevo = new Cliente();
                nuevo.setCodCliente(codClienteRaw.trim());
                nuevo.setNombreCliente(nombreCliente.trim());
                if (!isBlank(ciudad))          nuevo.setCiudad(ciudad);
                if (!isBlank(codigoProveedor)) nuevo.setCodigoProveedor(codigoProveedor);

                repository.save(nuevo);
                inserted++;

                // Añadir a cache para que próximas filas lo vean como existente
                paresExistentes.add(par);
            }

        } catch (Exception e) {
            out.put("error", "Error al procesar el archivo: " + e.getMessage());
            return out;
        }

        out.put("fileName", file.getOriginalFilename());
        out.put("inserted", inserted);
        out.put("updated", updated); // se mantendrá 0 por la regla
        out.put("total", inserted + updated);
        out.put("errors", errors);
        out.put("warnings", warnings);
        return out;
    }

    // === Helpers de normalización para la CLAVE del PAR ===
    private static String pairKey(String cod, String nom) {
        return normalizeForKey(cod) + "|" + normalizeForKey(nom);
    }

    /** UPPER + trim + colapsa espacios + elimina tildes (misma regla que usarás en BD si pones índice único). */
    private static String normalizeForKey(String s) {
        if (s == null) return "";
        String t = java.text.Normalizer.normalize(s, java.text.Normalizer.Form.NFD)
                    .replaceAll("\\p{M}", "");           // sin acentos
        t = t.trim().replaceAll("\\s+", " ");            // colapsa espacios
        return t.toUpperCase(Locale.ROOT);
    }

    // ===== Helpers =====
    private static Map<String, Integer> readHeaderMap(Row headerRow) {
        Map<String, Integer> map = new LinkedHashMap<>();
        if (headerRow == null) return map;
        DataFormatter fmt = new DataFormatter();
        short lastCell = headerRow.getLastCellNum();
        for (int c = 0; c < lastCell; c++) {
            Cell cell = headerRow.getCell(c);
            String raw = (cell == null) ? "" : fmt.formatCellValue(cell);
            String key = normalizeKey(raw);
            if (!key.isEmpty()) map.put(key, c);
        }
        return map;
    }

    private static Integer findCol(Map<String, Integer> headerIndex, Map<String, String> aliases, String canonical) {
        Integer exact = headerIndex.get(normalizeKey(canonical));
        if (exact != null) return exact;
        for (Map.Entry<String, Integer> e : headerIndex.entrySet()) {
            String header = e.getKey();
            String mapped = aliases.get(header);
            if (canonical.equals(mapped)) return e.getValue();
        }
        return null;
    }

    private static String clean(String s) { return (s == null) ? null : s.trim(); }
    private static boolean isBlank(String s) { return s == null || s.trim().isEmpty(); }

    private static String normalizeKey(String s) {
        if (s == null) return "";
        String n = java.text.Normalizer.normalize(s, java.text.Normalizer.Form.NFD)
            .replaceAll("\\p{M}", "");
        n = n.toLowerCase(Locale.ROOT).trim();
        n = n.replaceAll("[\\s_]+", " ");
        return n;
    }

    private static String safeLower(String s) {
        return (s == null) ? "" : s.toLowerCase(Locale.ROOT).trim();
    }

    private static Map<String, Object> err(int row, String msg) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("row", row);
        m.put("message", msg);
        return m;
    }

    private static Map<String, Object> warn(int row, String msg) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("row", row);
        m.put("message", msg);
        return m;
    }
    // Cache opcional para evitar hits repetidos a DB en una misma ejecución
    private final Map<String, Boolean> cacheCodClienteExiste = new java.util.concurrent.ConcurrentHashMap<>();

    // ===== Nuevo: validación por codCliente =====
    /** Valida existencia en DB de un Cliente por codCliente (trim + ignore case), usando Repository. */
    public boolean existsCodCliente(String codCliente) {
        if (codCliente == null) return false;
        String key = codCliente.trim().toLowerCase(Locale.ROOT);
        if (key.isEmpty()) return false;

        // Memoriza resultados para llamadas repetidas en el mismo request/proceso
        return cacheCodClienteExiste.computeIfAbsent(key,
            k -> repository.existsByCodClienteIgnoreCase(codCliente.trim()));
    }

    /** (Opcional) Obtiene el Cliente por codCliente (ignore case). */
    public Optional<Cliente> findByCodCliente(String codCliente) {
        if (codCliente == null) return Optional.empty();
        String val = codCliente.trim();
        if (val.isEmpty()) return Optional.empty();
        return repository.findFirstByCodClienteIgnoreCase(val);
    }

}
