# To change this license header, choose License Headers in Project Properties.
# To change this template file, choose Tools | Templates
# and open the template in the editor.
FROM openjdk:17-alpine
COPY target/eurekaserver-1.0.jar app.jar
ENTRYPOINT [ "java", "-jar", "app.jar" ]
