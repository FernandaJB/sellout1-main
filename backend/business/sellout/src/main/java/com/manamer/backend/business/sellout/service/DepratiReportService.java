package com.manamer.backend.business.sellout.service;

import com.manamer.backend.business.sellout.models.TipoMueble;
import org.apache.poi.ss.usermodel.Row;
import org.apache.poi.ss.usermodel.Sheet;
import org.apache.poi.xssf.usermodel.XSSFWorkbook;
import org.springframework.stereotype.Service;

import java.util.List;

@Service
public class DepratiReportService {
    private final TipoMuebleService tipoMuebleService;

    public DepratiReportService(TipoMuebleService tipoMuebleService) {
        this.tipoMuebleService = tipoMuebleService;
    }

    public byte[] generarReporteTipoMuebleXlsx() {
        try (XSSFWorkbook wb = new XSSFWorkbook();
             java.io.ByteArrayOutputStream baos = new java.io.ByteArrayOutputStream()) {
            Sheet sheet = wb.createSheet("TipoMueble");
            int rowIdx = 0;

            Row header = sheet.createRow(rowIdx++);
            String[] cols = {"ID", "CodCliente", "NombreCliente", "Ciudad", "CodPDV", "NombrePDV", "TipoMuebleEssence", "Marca"};
            for (int i = 0; i < cols.length; i++) header.createCell(i).setCellValue(cols[i]);

            List<TipoMueble> data = tipoMuebleService.obtenerTodosLosTiposMuebleDeprati();
            for (TipoMueble tm : data) {
                Row r = sheet.createRow(rowIdx++);
                r.createCell(0).setCellValue(tm.getId() != null ? tm.getId() : 0);
                r.createCell(1).setCellValue(tm.getCliente() != null ? String.valueOf(tm.getCliente().getCodCliente()) : "");
                r.createCell(2).setCellValue(tm.getCliente() != null ? String.valueOf(tm.getCliente().getNombreCliente()) : "");
                r.createCell(3).setCellValue(tm.getCiudad() != null ? tm.getCiudad() : "");
                r.createCell(4).setCellValue(tm.getCodPdv() != null ? tm.getCodPdv() : "");
                r.createCell(5).setCellValue(tm.getNombrePdv() != null ? tm.getNombrePdv() : "");
                r.createCell(6).setCellValue(tm.getTipoMuebleEssence() != null ? tm.getTipoMuebleEssence() : "");
                r.createCell(7).setCellValue(tm.getMarca() != null ? tm.getMarca() : "");
            }
            for (int i = 0; i < cols.length; i++) sheet.autoSizeColumn(i);

            wb.write(baos);
            return baos.toByteArray();
        } catch (Exception e) {
            throw new RuntimeException(e);
        }
    }
}

