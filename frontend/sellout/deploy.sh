@ -0,0 +1,56 @@
#!/bin/bash

# === CONFIGURACIÓN ===
SERVER="sistemas@192.168.246.233"
REMOTE_PATH="/home/sistemas/Sellout/Front/"
LOCAL_BUILD_PATH="./build"
CONTAINER_NAME="sellout-front"
REMOTE_URL="http://192.168.246.233:8092"

echo ""
echo "🛠️  Generando nuevo build de React..."
npm run build

if [ $? -ne 0 ]; then
  echo "❌ Error al generar el build. Cancela despliegue."
  exit 1
fi

if [ ! -d "$LOCAL_BUILD_PATH" ]; then
  echo "❌ No se encontró la carpeta $LOCAL_BUILD_PATH."
  exit 1
fi

echo ""
echo "📤 Subiendo archivos al servidor ($SERVER)..."

# Asegurar que el directorio remoto exista
ssh $SERVER "mkdir -p $REMOTE_PATH/build"

if command -v rsync &> /dev/null; then
  echo "🔁 Usando rsync para sincronizar archivos..."
  rsync -avz --delete "$LOCAL_BUILD_PATH/" "$SERVER:$REMOTE_PATH/build/"
else
  echo "⚠️  rsync no disponible. Limpiando y subiendo con scp..."
  ssh $SERVER "rm -rf $REMOTE_PATH/build/*"
  scp -r "$LOCAL_BUILD_PATH"/* "$SERVER:$REMOTE_PATH/build/"
fi

if [ $? -ne 0 ]; then
  echo "❌ Falló la transferencia de archivos."
  exit 1
fi

echo ""
read -p "¿Deseas reiniciar el contenedor Docker '$CONTAINER_NAME'? (s/n): " REINICIAR

if [[ "$REINICIAR" =~ ^[sS]$ ]]; then
  echo "🔁 Reiniciando contenedor..."
  ssh $SERVER "docker restart $CONTAINER_NAME"
  echo "✅ Contenedor reiniciado."
else
  echo "⏭️  No se reinició el contenedor."
fi

echo ""
echo "✅ Cambios desplegados. Revisa: $REMOTE_URL"