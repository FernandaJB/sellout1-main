package com.manamer.backend.business.sellout.models;

import org.apache.poi.ss.usermodel.*;
import org.apache.poi.xssf.usermodel.XSSFWorkbook;

import java.io.ByteArrayOutputStream;
import java.io.FileInputStream;
import java.io.IOException;
import java.util.ArrayList;
import java.util.List;

public class ExcelUtils {

    public static List<List<String>> readExcel(String filePath) throws IOException {
        List<List<String>> data = new ArrayList<>();
        try (FileInputStream fis = new FileInputStream(filePath);
             Workbook workbook = new XSSFWorkbook(fis)) {
            Sheet sheet = workbook.getSheetAt(0);

            for (Row row : sheet) {
                List<String> rowData = new ArrayList<>();
                for (Cell cell : row) {
                    rowData.add(cell.toString());
                }
                data.add(rowData);
            }
        }
        return data;
    }

     // Método para convertir un XSSFWorkbook en un arreglo de bytes
     public static byte[] convertWorkbookToByteArray(XSSFWorkbook workbook) throws IOException {
        try (ByteArrayOutputStream byteArrayOutputStream = new ByteArrayOutputStream()) {
            // Escribe el workbook a la salida
            workbook.write(byteArrayOutputStream);
            return byteArrayOutputStream.toByteArray();  // Devuelve el arreglo de bytes
        }
    }
}