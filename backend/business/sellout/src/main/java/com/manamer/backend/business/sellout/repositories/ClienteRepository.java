package com.manamer.backend.business.sellout.repositories;


import java.text.Normalizer;
import java.util.List;
import java.util.Locale;
import java.util.Optional;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.JpaSpecificationExecutor;
import org.springframework.data.jpa.repository.Query;
import org.springframework.stereotype.Repository;

import com.manamer.backend.business.sellout.models.Cliente;

@Repository
public interface ClienteRepository extends JpaRepository<Cliente, Long> {

    // Verifica existencia por codCliente ignorando mayúsculas/minúsculas
    boolean existsByCodClienteIgnoreCase(String codCliente);

    // Búsqueda directa por código (match exacto)
    Optional<Cliente> findFirstByCodCliente(String codCliente);

    // Búsqueda por nombre contiene (case-insensitive)
    List<Cliente> findByNombreClienteIgnoreCaseContaining(String nombreCliente);

    // Opcional: nativa por ID (similar a tu estilo en VentaRepository)
    @Query(value = "SELECT * FROM SELLOUT.dbo.cliente c WHERE c.id = ?1", nativeQuery = true)
    Optional<Cliente> obtenerClienteNativo(Long clienteId);

    // ===== Helpers estilo default (sin axios) =====
    default Optional<Cliente> findByCodClienteLimpio(String codCliente) {
        String limpio = limpiar(codCliente);
        if (limpio.isEmpty()) return Optional.empty();
        // Buscamos exacto tal como guardamos; si guardas normalizado, usa la misma normalización para guardar y buscar
        return findFirstByCodCliente(limpio);
    }

    static String limpiar(String s) {
        if (s == null) return "";
        String n = Normalizer.normalize(s, Normalizer.Form.NFD)
                .replaceAll("\\p{M}", "");
        n = n.toLowerCase(Locale.ROOT).trim();
        // Si decides normalizar a “como guardas”, aquí puedes quitar espacios/guiones, etc.
        // Para match exacto “humano” usualmente NO se remueven todos los espacios.
        return n;
    }

    Optional<Cliente> findFirstByCodClienteIgnoreCase(String codCliente);
    // Existe el par (codCliente, nombreCliente) ignorando mayúsculas
    boolean existsByCodClienteIgnoreCaseAndNombreClienteIgnoreCase(String codCliente, String nombreCliente);

    Optional<Cliente> findByCodCliente(String codCliente);

}