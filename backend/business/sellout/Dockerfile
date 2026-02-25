# Imagen base
FROM eclipse-temurin:17-jdk-alpine

# Crear la carpeta de salida y asegurar permisos
RUN addgroup -S paymentchain && adduser -S admin -G paymentchain

# Cambiar al usuario no root
USER admin:paymentchain

# Definir el volumen para permitir persistencia/montaje externo
VOLUME /tmp

# Copiar el JAR a la imagen
COPY target/sellout-1.0.jar app.jar

# Copiar override de seguridad para permitir TLS 1.0 (INSEGURO)
COPY java-security-override.properties /java-security-override.properties

# Variable opcional para pasar opciones a la JVM
ENV JAVA_OPTS=""

# Forzar TLS 1.0 y cargar override (INSEGURO)
ENV JAVA_TOOL_OPTIONS="-Djdk.tls.client.protocols=TLSv1 -Djava.security.properties=/java-security-override.properties"

# Ejecutar la aplicación
ENTRYPOINT [ "sh", "-c", "java $JAVA_OPTS $JAVA_TOOL_OPTIONS -Djava.security.egd=file:/dev/./urandom -jar /app.jar" ]