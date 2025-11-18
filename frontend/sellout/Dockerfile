# Establecer la imagen base
FROM node:16 as build

# Establecer el directorio de trabajo en la imagen
WORKDIR /app

# Copiar package.json y package-lock.json primero para aprovechar la caché de Docker
COPY package*.json ./

# Instalar las dependencias
RUN npm install

# Instalar explícitamente las dependencias que faltan
RUN npm install --save primeflex xlsx @fortawesome/fontawesome-free @fortawesome/react-fontawesome @fortawesome/free-solid-svg-icons

# Copiar el resto de los archivos al directorio de trabajo
COPY . .

# Exponer el puerto 3000
EXPOSE 8093

# Comando para iniciar la aplicación
CMD ["npm", "start"]