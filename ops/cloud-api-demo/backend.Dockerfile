# Baut den DJI-Cloud-API-Demo-Server (Maven, Java 11, Spring Boot 2.7) ohne Maven auf dem Host.
FROM maven:3.9-eclipse-temurin-11 AS build
WORKDIR /src
COPY pom.xml ./
COPY cloud-sdk/pom.xml cloud-sdk/pom.xml
COPY sample/pom.xml sample/pom.xml
RUN mvn -B -q -DskipTests dependency:go-offline || true
COPY cloud-sdk cloud-sdk
COPY sample sample
# Das Root-Pom deklariert das Spring-Boot-Plugin ohne repackage-Ausfuehrung (kein Starter-Parent): ohne diese Zeile entsteht
# nur ein 1-MB-Jar ohne Abhaengigkeiten und Startklasse. Nur im Build-Container, die geklonten Quellen bleiben unveraendert.
RUN sed -i 's#</project>#<build><plugins><plugin><groupId>org.springframework.boot</groupId><artifactId>spring-boot-maven-plugin</artifactId><version>2.7.12</version><executions><execution><goals><goal>repackage</goal></goals></execution></executions></plugin></plugins></build></project>#' sample/pom.xml
RUN mvn -B -q -DskipTests package -pl sample -am \
 && cp "$(ls sample/target/sample-*.jar | grep -v -E 'sources|original' | head -1)" /app.jar

FROM eclipse-temurin:11-jre
RUN useradd --system --uid 10001 --home /app app && mkdir -p /app/logs && chown app /app/logs
WORKDIR /app
COPY --from=build /app.jar /app/app.jar
USER app
EXPOSE 6789
ENTRYPOINT ["java", "-jar", "/app/app.jar"]
