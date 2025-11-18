package com.manamer.backend.business.sellout.controller;

import com.manamer.backend.business.sellout.models.Cliente;
import com.manamer.backend.business.sellout.service.ClienteService;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

import java.util.*;

@RestController
@CrossOrigin(origins = "*", allowedHeaders = "*",
        methods = {RequestMethod.GET, RequestMethod.POST, RequestMethod.PUT, RequestMethod.DELETE})
@RequestMapping("/api-sellout/clientes")
public class ClienteController {

    private final ClienteService service;
    public ClienteController(ClienteService service) { this.service = service; }

    @GetMapping("/empresas")
    public List<Cliente> listar() {
        return service.getAllClientes();
    }

    @GetMapping("/empresas/{id}")
    public ResponseEntity<Cliente> obtener(@PathVariable Long id) {
        return service.getClienteById(id)
                .map(ResponseEntity::ok)
                .orElse(ResponseEntity.notFound().build());
    }

    @PostMapping("/empresas")
    public Cliente crear(@RequestBody Cliente c) {
        return service.saveOrUpdate(c);
    }

    @PutMapping("/empresas/{id}")
    public ResponseEntity<Cliente> actualizar(@PathVariable Long id, @RequestBody Cliente c) {
        return service.getClienteById(id)
                .map(actual -> {
                    actual.setCodCliente(c.getCodCliente());
                    actual.setNombreCliente(c.getNombreCliente());
                    actual.setCiudad(c.getCiudad());
                    actual.setCodigoProveedor(c.getCodigoProveedor());
                    return ResponseEntity.ok(service.saveOrUpdate(actual));
                })
                .orElse(ResponseEntity.notFound().build());
    }

    @DeleteMapping("/empresas/{id}")
    public ResponseEntity<Void> eliminar(@PathVariable Long id) {
        service.deleteCliente(id);
        return ResponseEntity.noContent().build();
    }

    @PostMapping("/empresas/upload-xlsx")
    public Map<String, Object> upload(@RequestParam("file") MultipartFile file) {
        return service.uploadClientesFromExcel(file);
    }
}