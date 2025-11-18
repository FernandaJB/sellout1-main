package com.manamer.backend.business.sellout.models;

import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import lombok.Data;

@Entity
@Data
public class MantenimientoCliente {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    private String cod_Cliente;

    private String nombre_Cliente;

    private String ciudad;

    private String codigo_Proveedor;
}