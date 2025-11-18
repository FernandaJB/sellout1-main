/*
 * Click nbfs://nbhost/SystemFileSystem/Templates/Licenses/license-default.txt to change this license
 * Click nbfs://nbhost/SystemFileSystem/Templates/Classes/Class.java to edit this template
 */
package com.manamer.backend.business.sellout.models;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.FetchType;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.ManyToOne;
import lombok.Data;
import jakarta.persistence.Transient;
/**
 *
 * @author Fernanda Jama
 */
@Data
@Entity
public class Venta {
    
    
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;
    
    private Integer anio;
    private Integer mes;
    private int dia;
    private String ciudad;
    private String marca;
    private double ventaDolares;
    private double ventaUnidad;
    private String nombreProducto;
    private String codigoSap;
    private String codBarra;
    private String codPdv;
    private String descripcion;
    private String pdv;
    private double stockDolares;
    private double stockUnidades;
    

     @ManyToOne(fetch = FetchType.EAGER)
     @JoinColumn(name = "cliente_id", referencedColumnName = "id")
     private Cliente cliente;

     @ManyToOne(fetch = FetchType.EAGER)
     @JoinColumn(name = "producto_id", referencedColumnName = "id")
     private Producto producto;

    private String unidadesDiarias;
 }
