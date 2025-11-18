package com.manamer.backend.business.sellout.models;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.Data;

@Entity
@Data
@Table(name = "template_config")
public class TemplateConfig {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;
    
    private String templateName;
    private int rowCodPdv;
    private int rowPdv;
    private int rowDataStart;
    private int colMarca;
    private int colNombreProducto;
    private int colCodBarra;
    private int colFecha;
    private int colStartPdv;
    private int colStepPdv;
    
    // Getters y setters
}