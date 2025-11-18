package com.manamer.backend.business.sellout.service;

import java.io.IOException;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;

import org.apache.poi.ss.usermodel.*;
import org.apache.poi.xssf.usermodel.XSSFWorkbook;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.web.multipart.MultipartFile;

import com.manamer.backend.business.sellout.models.MantenimientoProducto;
import com.manamer.backend.business.sellout.repositories.MantenimientoProductoRepository;

@Service
public class MantenimientoProductoService {

    @Autowired
    private MantenimientoProductoRepository repository;

    public Optional<MantenimientoProducto> findById(Long id) {
        return repository.findById(id); // Llama al repositorio para obtener el producto por ID
    }

    // Método para guardar o actualizar un producto
    public MantenimientoProducto saveOrUpdate(MantenimientoProducto producto) {
        return repository.save(producto);
    }

    // Método para obtener todos los productos
    public List<MantenimientoProducto> getAllProductos() {
        return repository.findAll();
    }

    // Método para eliminar un producto por su ID
    public void deleteProductoById(Long id) {
        if (repository.existsById(id)) {
            repository.deleteById(id);
        } else {
            throw new IllegalArgumentException("El producto con el ID especificado no existe.");
        }
    }

    // Método para eliminar varios productos
    public void deleteProductos(List<Long> ids) {
        if (ids == null || ids.isEmpty()) {
            throw new IllegalArgumentException("No se proporcionaron IDs para eliminar.");
        }

        List<MantenimientoProducto> productos = repository.findAllById(ids);
        if (productos.isEmpty()) {
            throw new IllegalArgumentException("No existen productos con los IDs proporcionados.");
        }

        repository.deleteAllInBatch(productos); // Optimizado para eliminar en lotes
    }
   

    // Método para cargar productos desde un archivo XLSX
    public String cargarProductosDesdeArchivo(MultipartFile file) {
        if (file.isEmpty()) {
            return "El archivo está vacío.";
        }

        try (InputStream inputStream = file.getInputStream()) {
            Workbook workbook = new XSSFWorkbook(inputStream);
            Sheet sheet = workbook.getSheetAt(0);
            List<MantenimientoProducto> productos = new ArrayList<>();

            // Iterar sobre las filas del archivo
            for (Row row : sheet) {
                if (row.getRowNum() == 0) continue; // Salta la primera fila (encabezados)

                MantenimientoProducto producto = new MantenimientoProducto();
                producto.setCod_Item(row.getCell(0).getStringCellValue());
                producto.setCod_Barra_Sap(row.getCell(1).getStringCellValue());

                productos.add(producto);
            }

            // Guardar los productos en la base de datos
            repository.saveAll(productos);
            return "Productos cargados correctamente.";

        } catch (IOException e) {
            return "Error al cargar el archivo: " + e.getMessage();
        }
    }

    // Método para guardar una lista de productos
    public void guardarProductos(List<MantenimientoProducto> productos) {
        repository.saveAll(productos);
    }

    // Constructor para inyección de dependencias
    public MantenimientoProductoService(MantenimientoProductoRepository productoRepositorio) {
        this.repository = productoRepositorio;
    }
}