package com.manamer.backend.business.sellout.repositories;



import java.util.Collection;
import java.util.List;
import java.util.Optional;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import com.manamer.backend.business.sellout.models.Producto;

@Repository
public interface ProductoRepository extends JpaRepository<Producto, Long> {
    
   Optional<Producto> findByCodItemAndCodBarraSap(String codItem, String codBarraSap);

    List<Producto> findAllByCodItemIn(Collection<String> codItems);

    boolean existsByCodItemAndCodBarraSap(String codItem, String codBarraSap);

    // 🔹 Proyección ligera para pintar en UI
    interface ProductoMinView {
        Long getId();
        String getCodItem();
        String getCodBarraSap();
    }

    // Trae info mínima por ids (para armar el detalle en la respuesta)
    List<ProductoMinView> findAllByIdIn(Collection<Long> ids);

    // Ids que están referenciados en ventas
    @org.springframework.data.jpa.repository.Query(
        value = """
            SELECT DISTINCT v.producto_id
            FROM dbo.venta v
            WHERE v.producto_id IN (:ids)
        """,
        nativeQuery = true
    )
    List<Long> findReferencedProductoIdsInVentas(@org.springframework.data.repository.query.Param("ids") Collection<Long> ids);
}