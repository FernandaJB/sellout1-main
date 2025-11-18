package com.manamer.backend.business.sellout.service;

import java.io.IOException;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Optional;
import java.util.stream.Collectors;

import org.apache.poi.hssf.usermodel.HSSFWorkbook;
import org.apache.poi.ss.usermodel.Cell;
import org.apache.poi.ss.usermodel.CellType;
import org.apache.poi.ss.usermodel.Row;
import org.apache.poi.ss.usermodel.Sheet;
import org.apache.poi.ss.usermodel.Workbook;
import org.apache.poi.xssf.usermodel.XSSFWorkbook;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.web.multipart.MultipartFile;

import com.manamer.backend.business.sellout.models.Cliente;
import com.manamer.backend.business.sellout.models.TipoMueble;
import com.manamer.backend.business.sellout.repositories.ClienteRepository;
import com.manamer.backend.business.sellout.repositories.TipoMuebleRepository;

@Service
public class TipoMuebleService {

    public static final String COD_CLIENTE_DEPRATI = "MZCL-000009";
    public static final String COD_CLIENTE_FYBECA  = "MZCL-000014";

    private final TipoMuebleRepository tipoMuebleRepository;
    private final ClienteRepository clienteRepository;

    @Autowired
    public TipoMuebleService(TipoMuebleRepository tipoMuebleRepository, ClienteRepository clienteRepository) {
        this.tipoMuebleRepository = tipoMuebleRepository;
        this.clienteRepository = clienteRepository;
    }

    // ===== CRUD =====

    public TipoMueble guardarTipoMueble(TipoMueble tipoMueble) {
        return tipoMuebleRepository.save(tipoMueble);
    }

    public List<TipoMueble> obtenerTodosLosTiposMueble() {
        return tipoMuebleRepository.findAll();
    }

    public List<TipoMueble> obtenerTodosLosTiposMuebleDeprati() {
        return tipoMuebleRepository.findAll().stream()
                .filter(tm -> tm.getCliente() != null
                        && COD_CLIENTE_DEPRATI.equals(tm.getCliente().getCodCliente()))
                .collect(Collectors.toList());
    }

    public List<TipoMueble> obtenerTodosLosTiposMuebleFybeca() {
        return tipoMuebleRepository.findAll().stream()
                .filter(tm -> tm.getCliente() != null
                        && COD_CLIENTE_FYBECA.equals(tm.getCliente().getCodCliente()))
                .collect(Collectors.toList());
    }

    public Optional<TipoMueble> obtenerTipoMueblePorId(Long id) {
        return tipoMuebleRepository.findById(id);
    }

    public TipoMueble actualizarTipoMueble(Long id, TipoMueble nuevoTipoMueble) {
        return tipoMuebleRepository.findById(id).map(tm -> {
            tm.setCodPdv(nuevoTipoMueble.getCodPdv());
            tm.setNombrePdv(nuevoTipoMueble.getNombrePdv());
            tm.setTipoMuebleEssence(nuevoTipoMueble.getTipoMuebleEssence());
            tm.setTipoMuebleCatrice(nuevoTipoMueble.getTipoMuebleCatrice());
            tm.setCiudad(nuevoTipoMueble.getCiudad());
            tm.setMarca(nuevoTipoMueble.getMarca());
            tm.setCliente(nuevoTipoMueble.getCliente());
            return tipoMuebleRepository.save(tm);
        }).orElseThrow(() -> new RuntimeException("TipoMueble no encontrado con el ID: " + id));
    }

    public boolean eliminarTipoMueble(Long id) {
        return tipoMuebleRepository.findById(id).map(tm -> {
            tipoMuebleRepository.delete(tm);
            return true;
        }).orElse(false);
    }

    public boolean eliminarTiposMueble(List<Long> ids) {
        var list = tipoMuebleRepository.findAllById(ids);
        if (list.isEmpty()) return false;
        tipoMuebleRepository.deleteAll(list);
        return true;
    }

    public List<TipoMueble> obtenerTiposMueblePorCliente(Long idCliente) {
        return tipoMuebleRepository.findAll().stream()
                .filter(tm -> tm.getCliente() != null && tm.getCliente().getId().equals(idCliente))
                .collect(Collectors.toList());
    }

    // ===== Cargas desde archivos =====

    /**
     * Carga genérica: usa el código de cliente para resolver y asignar el ID real.
     * Sirve para Deprati y Fybeca.
     */
    public List<TipoMueble> cargarTipoMueblesDesdeArchivo(MultipartFile file, String codCliente) {
        List<TipoMueble> tipoMuebles = new ArrayList<>();
        try (Workbook workbook = new XSSFWorkbook(file.getInputStream())) {
            Sheet sheet = workbook.getSheetAt(0);
            // Fila 0 = encabezado
            for (int r = 1; r <= sheet.getLastRowNum(); r++) {
                Row row = sheet.getRow(r);
                if (row == null) continue;

                // Si toda la fila está vacía, saltar
                if (filaVacia(row)) continue;

                TipoMueble tm = new TipoMueble();
                tm.setCodPdv(getString(row, 0));
                tm.setNombrePdv(getString(row, 1));
                tm.setTipoMuebleEssence(getString(row, 2));
                tm.setTipoMuebleCatrice(getString(row, 3));
                tm.setCiudad(getString(row, 4));
                tm.setMarca(getString(row, 5));

                tm.setCliente(resolveClienteByCodigo(codCliente)); // asigna ID real
                tipoMuebles.add(tm);
            }
            return tipoMuebleRepository.saveAll(tipoMuebles);
        } catch (IOException e) {
            throw new RuntimeException("Error al cargar el archivo: " + e.getMessage(), e);
        }
    }

    /**
     * Deprati: atajo que delega a la genérica, fijando el código de cliente MZCL-000009.
     */
    public List<TipoMueble> cargarTipoMueblesDesdeArchivoDeprati(MultipartFile file) {
        return cargarTipoMueblesDesdeArchivo(file, COD_CLIENTE_DEPRATI);
    }

    /**
     * Fybeca: atajo que delega a la genérica, fijando el código de cliente MZCL-000014.
     */
    public List<TipoMueble> cargarTipoMueblesDesdeArchivoFybeca(MultipartFile file) {
        return cargarTipoMueblesDesdeArchivo(file, COD_CLIENTE_FYBECA);
    }

    // ===== Helpers =====

    private Workbook crearWorkbook(MultipartFile file) throws IOException {
        String nombre = file.getOriginalFilename();
        if (nombre != null && nombre.toLowerCase().endsWith(".xls")) {
            return new HSSFWorkbook(file.getInputStream());
        } else if (nombre != null && nombre.toLowerCase().endsWith(".xlsx")) {
            return new XSSFWorkbook(file.getInputStream());
        }
        throw new IllegalArgumentException("Formato no soportado: " + nombre);
    }

    private boolean filaVacia(Row row, int... columnas) {
        if (row == null) return true;
        if (columnas == null || columnas.length == 0) {
            short last = row.getLastCellNum();
            for (int c = 0; c < last; c++) {
                if (notBlank(getString(row, c))) return false;
            }
            return true;
        } else {
            for (int c : columnas) {
                if (notBlank(getString(row, c))) return false;
            }
            return true;
        }
    }

    private boolean notBlank(String s) {
        return s != null && !s.trim().isEmpty();
    }

    private String getString(Row row, int col) {
        try {
            Cell cell = row.getCell(col);
            if (cell == null) return null;

            if (cell.getCellType() == CellType.STRING) {
                String v = cell.getStringCellValue();
                return v == null ? null : v.trim();
            } else if (cell.getCellType() == CellType.NUMERIC) {
                double d = cell.getNumericCellValue();
                long asLong = (long) d;
                if (Math.abs(d - asLong) < 1e-9) return String.valueOf(asLong);
                return String.valueOf(d);
            } else if (cell.getCellType() == CellType.BOOLEAN) {
                return String.valueOf(cell.getBooleanCellValue());
            } else if (cell.getCellType() == CellType.FORMULA) {
                try {
                    return cell.getStringCellValue().trim();
                } catch (IllegalStateException ex) {
                    try {
                        double val = cell.getNumericCellValue();
                        long li = (long) val;
                        if (Math.abs(val - li) < 1e-9) return String.valueOf(li);
                        return String.valueOf(val);
                    } catch (Exception ignored) {
                        return null;
                    }
                }
            }
            return null;
        } catch (Exception e) {
            return null;
        }
    }

    private Cliente resolveClienteByCodigo(String codCliente) {
        return clienteRepository.findByCodCliente(codCliente)
                .orElseThrow(() -> new IllegalStateException(
                        "Cliente no encontrado con codCliente: " + codCliente));
    }
}
