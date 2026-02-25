package com.manamer.backend.business.sellout.service;

import com.manamer.backend.business.sellout.models.ExcelUtils;
import com.manamer.backend.business.sellout.models.Producto;
import com.manamer.backend.business.sellout.models.TipoMueble;
import com.manamer.backend.business.sellout.models.Venta;
import org.apache.poi.ss.usermodel.Row;
import org.apache.poi.ss.usermodel.Sheet;
import org.apache.poi.xssf.usermodel.XSSFWorkbook;
import org.springframework.stereotype.Service;

import java.util.List;

@Service
public class FybecaReportService {
    private final FybecaVentaService fybecaService;
    private final ProductoService productoService;
    private final TipoMuebleService tipoMuebleService;

    public FybecaReportService(FybecaVentaService fybecaService, ProductoService productoService, TipoMuebleService tipoMuebleService) {
        this.fybecaService = fybecaService;
        this.productoService = productoService;
        this.tipoMuebleService = tipoMuebleService;
    }

    public byte[] generarReporteVentasXlsx(String codCliente) {
        try (XSSFWorkbook workbook = new XSSFWorkbook()) {
            List<Venta> ventas = fybecaService.obtenerTodasLasVentasPorCodCliente(codCliente);
            Sheet sheet = workbook.createSheet("Ventas");

            Row header = sheet.createRow(0);
            header.createCell(0).setCellValue("Año");
            header.createCell(1).setCellValue("Mes");
            header.createCell(2).setCellValue("Marca");
            header.createCell(3).setCellValue("Código Cliente");
            header.createCell(4).setCellValue("Nombre Cliente");
            header.createCell(5).setCellValue("Código Barra SAP");
            header.createCell(6).setCellValue("Código Producto SAP");
            header.createCell(7).setCellValue("Código Item");
            header.createCell(8).setCellValue("Nombre Producto");
            header.createCell(9).setCellValue("Código PDV");
            header.createCell(10).setCellValue("Ciudad");
            header.createCell(11).setCellValue("PDV");
            header.createCell(12).setCellValue("Stock en Dólares");
            header.createCell(13).setCellValue("Stock en Unidades");
            header.createCell(14).setCellValue("Venta en Dólares");
            header.createCell(15).setCellValue("Venta en Unidades");

            int rowNum = 1;
            for (Venta venta : ventas) {
                Row row = sheet.createRow(rowNum++);

                row.createCell(0).setCellValue(venta.getAnio() != null ? venta.getAnio() : 0);
                row.createCell(1).setCellValue(venta.getMes() != null ? venta.getMes() : 0);

                row.createCell(2).setCellValue(venta.getMarca() != null ? venta.getMarca() : "");

                if (venta.getCliente() != null) {
                    row.createCell(3).setCellValue(venta.getCliente().getCodCliente() != null ? venta.getCliente().getCodCliente() : "");
                    row.createCell(4).setCellValue(venta.getCliente().getNombreCliente() != null ? venta.getCliente().getNombreCliente() : "");
                    row.createCell(10).setCellValue(venta.getCliente().getCiudad() != null ? venta.getCliente().getCiudad() : "");
                } else {
                    row.createCell(3).setCellValue("N/A");
                    row.createCell(4).setCellValue("N/A");
                    row.createCell(10).setCellValue("N/A");
                }

                row.createCell(5).setCellValue(venta.getCodBarra() != null ? venta.getCodBarra() : "");
                row.createCell(6).setCellValue(venta.getCodigoSap() != null ? venta.getCodigoSap() : "");

                if (venta.getProducto() != null) {
                    row.createCell(7).setCellValue(venta.getProducto().getCodItem() != null ? venta.getProducto().getCodItem() : "");
                    row.createCell(8).setCellValue(venta.getNombreProducto() != null ? venta.getNombreProducto() : "");
                } else {
                    row.createCell(7).setCellValue("N/A");
                    row.createCell(8).setCellValue("N/A");
                }

                row.createCell(9).setCellValue(venta.getCodPdv() != null ? venta.getCodPdv() : "");
                row.createCell(11).setCellValue(venta.getPdv() != null ? venta.getPdv() : "");

                row.createCell(12).setCellValue(venta.getStockDolares());
                row.createCell(13).setCellValue(venta.getStockUnidades());
                row.createCell(14).setCellValue(venta.getVentaDolares());
                row.createCell(15).setCellValue(venta.getVentaUnidad());
            }

            return ExcelUtils.convertWorkbookToByteArray(workbook);
        } catch (Exception e) {
            throw new RuntimeException(e);
        }
    }

    public byte[] generarReporteProductosXlsx() {
        try (XSSFWorkbook workbook = new XSSFWorkbook()) {
            List<Producto> productos = productoService.getAllProductos();
            Sheet sheet = workbook.createSheet("Productos");

            Row header = sheet.createRow(0);
            header.createCell(0).setCellValue("Código Item");
            header.createCell(1).setCellValue("Código Barra SAP");

            int rowNum = 1;
            for (Producto producto : productos) {
                Row row = sheet.createRow(rowNum++);
                row.createCell(0).setCellValue(producto.getCodItem());
                row.createCell(1).setCellValue(producto.getCodBarraSap());
            }

            return ExcelUtils.convertWorkbookToByteArray(workbook);
        } catch (Exception e) {
            throw new RuntimeException(e);
        }
    }

    public byte[] generarReporteTipoMuebleXlsx() {
        try (XSSFWorkbook workbook = new XSSFWorkbook()) {
            List<TipoMueble> tiposMueble = tipoMuebleService.obtenerTodosLosTiposMuebleFybeca();
            Sheet sheet = workbook.createSheet("Tipos de Mueble");

            Row header = sheet.createRow(0);
            header.createCell(0).setCellValue("Código Cliente");
            header.createCell(1).setCellValue("Nombre Cliente");
            header.createCell(2).setCellValue("Ciudad");
            header.createCell(3).setCellValue("Código PDV");
            header.createCell(4).setCellValue("Nombre PDV");
            header.createCell(5).setCellValue("Tipo Display Essence");
            header.createCell(6).setCellValue("Tipo Mueble Display Catrice");

            int rowNum = 1;
            for (TipoMueble tipoMueble : tiposMueble) {
                Row row = sheet.createRow(rowNum++);
                if (tipoMueble.getCliente() != null) {
                    row.createCell(0).setCellValue(tipoMueble.getCliente().getCodCliente());
                    row.createCell(1).setCellValue(tipoMueble.getCliente().getNombreCliente());
                    row.createCell(2).setCellValue(tipoMueble.getCiudad());
                } else {
                    row.createCell(0).setCellValue("N/A");
                    row.createCell(1).setCellValue("N/A");
                    row.createCell(2).setCellValue("N/A");
                }
                row.createCell(3).setCellValue(tipoMueble.getCodPdv());
                row.createCell(4).setCellValue(tipoMueble.getNombrePdv());
                row.createCell(5).setCellValue(tipoMueble.getTipoMuebleEssence());
                row.createCell(6).setCellValue(tipoMueble.getTipoMuebleCatrice());
            }

            return ExcelUtils.convertWorkbookToByteArray(workbook);
        } catch (Exception e) {
            throw new RuntimeException(e);
        }
    }
}

