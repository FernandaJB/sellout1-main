package com.manamer.backend.business.sellout.service;
import java.io.IOException;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.io.InputStream;
import org.apache.poi.ss.usermodel.Row;
import org.apache.poi.ss.usermodel.Sheet;

import org.apache.poi.ss.usermodel.Workbook;
import org.apache.poi.xssf.usermodel.XSSFWorkbook;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.web.multipart.MultipartFile;

import com.manamer.backend.business.sellout.models.MantenimientoCliente;
import com.manamer.backend.business.sellout.repositories.MantenimientoClienteRepository;


@Service
public class MantenimientoClienteService {

    @Autowired
    private MantenimientoClienteRepository mantenimientoClienteRepository;

    // Cambia el parámetro de String a Long
    public Optional<MantenimientoCliente> findById(Long id) {
        return mantenimientoClienteRepository.findById(id);  // Ahora el id es de tipo Long
    }
     @Autowired
    private MantenimientoClienteRepository repository;

    // Crear o actualizar un cliente
    public MantenimientoCliente saveOrUpdate(MantenimientoCliente cliente) {
        return repository.save(cliente);
    }

    // Obtener todos los clientes
    public List<MantenimientoCliente> getAllClientes() {
        return repository.findAll();
    }

    // Obtener un cliente por ID
    public Optional<MantenimientoCliente> getClienteById(Long id) {
        return repository.findById(id);
    }

    // Eliminar un cliente por ID
    public void deleteCliente(Long id) {
        repository.deleteById(id);
    }
    
     //Método para cargar clientes desde un archivo XLSX
    public String uploadClientesFromExcel(MultipartFile file) {
        try (InputStream is = file.getInputStream()) {
            Workbook workbook = new XSSFWorkbook(is);
            Sheet sheet = workbook.getSheetAt(0); // Obtener la primera hoja

            List<MantenimientoCliente> clientes = new ArrayList<>();
            for (Row row : sheet) {
                // Suponiendo que los datos comienzan en la segunda fila (índice 1)
                if (row.getRowNum() == 0) continue; // Saltar la primera fila (cabecera)

                MantenimientoCliente cliente = new MantenimientoCliente();
                cliente.setCod_Cliente(row.getCell(0).getStringCellValue()); // Primera columna (cod_Cliente)
                cliente.setNombre_Cliente(row.getCell(1).getStringCellValue()); // Segunda columna (nombre_Cliente)

                clientes.add(cliente);
            }

            // Guardar los clientes en la base de datos
            repository.saveAll(clientes);

            return "Archivo cargado con éxito. Se cargaron " + clientes.size() + " clientes.";
        } catch (IOException e) {
            return "Error al procesar el archivo: " + e.getMessage();
        }
    }
    
}
