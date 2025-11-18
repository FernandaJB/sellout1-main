package com.sellout.models;

import java.util.List;
import java.util.Map;

import lombok.Data;

@Data
public class UserSessionInfo {
    private String username;
    private String email;
    private Map<String, List<String>> rolesPorEmpresa; // clave = empresa (ej. SELLOUT), valor = lista de roles
}
