package com.sellout.service;


import com.sellout.models.LoginResponse;
import com.sellout.models.UserSessionInfo;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.ParameterizedTypeReference;
import org.springframework.http.*;
import org.springframework.stereotype.Service;
import org.springframework.util.LinkedMultiValueMap;
import org.springframework.util.MultiValueMap;
import org.springframework.web.client.HttpClientErrorException;
import org.springframework.web.client.RestClientException;
import org.springframework.web.client.RestTemplate;
import org.springframework.web.util.UriComponentsBuilder;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Base64;
import java.util.Collections;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Iterator;
import java.util.List;
import java.util.Map;
import java.util.Random;
import java.util.Set;


/**
 * Service for interacting with Keycloak.
 */
@Service
public class KeycloakRestService {

    @Autowired
    private RestTemplate restTemplate;

    @Value("${keycloak.base-uri}")
    private String keycloakBaseUri;

    @Value("${keycloak.token-uri}")
    private String keycloakTokenUri;

    @Value("${keycloak.user-info-uri}")
    private String keycloakUserInfo;

    @Value("${keycloak.logout}")
    private String keycloakLogout;

    @Value("${keycloak.client-id}")
    private String clientIdadmin;
    @Value("${keycloak.client-id}")
    private String clientId;

    @Value("${keycloak.authorization-grant-type}")
    private String grantType;

    @Value("${keycloak.authorization-grant-type-refresh}")
    private String grantTypeRefresh;

    @Value("${keycloak.client-secret}")
    private String clientSecret;

    @Value("${keycloak.scope}")
    private String scope;

    @Value("${keycloak.admin-username}")
    private String adminUsername;

    @Value("${keycloak.admin-password}")
    private String adminPassword;

    @Value("${email.service.uri}")
    private String emailServiceUri;

    @Value("${frontend.resetPasswordUrl}")
    private String resetPasswordUrl;

    private Map<String, String> verificationCodes = new HashMap<>();

    /**
     * Login using username and password to Keycloak, and capturing token on
     * response body.
     *
     * @param username the username
     * @param password the password
     * @return the token
     */
    public String login(String username, String password) {
        MultiValueMap<String, String> map = new LinkedMultiValueMap<>();
        map.add("username", username);
        map.add("password", password);
        map.add("client_id", clientId);
        map.add("grant_type", grantType);
        map.add("client_secret", clientSecret);
        map.add("scope", scope);

        HttpEntity<MultiValueMap<String, String>> request = new HttpEntity<>(map, new HttpHeaders());
        return restTemplate.postForObject(keycloakTokenUri, request, String.class);

    }

    /**
     * A successful user token will generate http code 200, other than that will
     * create an exception.
     *
     * @param token the token
     * @return the user info
     * @throws Exception the exception
     */
    public String checkValidity(String token) throws Exception {
        return getUserInfo(token);
    }

    private String getUserInfo(String token) {
        MultiValueMap<String, String> headers = new LinkedMultiValueMap<>();
        headers.add("Authorization", token);

        HttpEntity<MultiValueMap<String, String>> request = new HttpEntity<>(null, headers);
        return restTemplate.postForObject(keycloakUserInfo, request, String.class);
    }

    /**
     * Logging out and disabling active token from Keycloak.
     *
     * @param refreshToken the refresh token
     */
    public void logout(String refreshToken) throws Exception {
        MultiValueMap<String, String> map = new LinkedMultiValueMap<>();
        map.add("client_id", clientId);
        map.add("client_secret", clientSecret);
        map.add("refresh_token", refreshToken);

        HttpEntity<MultiValueMap<String, String>> request = new HttpEntity<>(map, null);
        restTemplate.postForObject(keycloakLogout, request, String.class);
    }

    public List<String> getRoles(String token) throws Exception {
        String response = getUserInfo(token);

        // get roles
        Map<String, Object> map = new ObjectMapper().readValue(response, HashMap.class);
        return (List<String>) map.get("roles");
    }

    /**
     * Refresh token.
     *
     * @param refreshToken the refresh token
     * @return the new token
     * @throws Exception the exception
     */
    public String refresh(String refreshToken) throws Exception {
        MultiValueMap<String, String> map = new LinkedMultiValueMap<>();
        map.add("client_id", clientId);
        map.add("grant_type", grantTypeRefresh);
        map.add("refresh_token", refreshToken);
        HttpEntity<MultiValueMap<String, String>> request = new HttpEntity<>(map, null);
        return restTemplate.postForObject(keycloakTokenUri, request, String.class);
    }

    public LoginResponse loginWithUserInfo(String username, String password) throws Exception {
        // Paso 1: Solicitar el token a Keycloak
        MultiValueMap<String, String> map = new LinkedMultiValueMap<>();
        map.add("username", username);
        map.add("password", password);
        map.add("client_id", clientId);
        map.add("grant_type", grantType);
        map.add("client_secret", clientSecret);
        map.add("scope", scope);

        HttpEntity<MultiValueMap<String, String>> request = new HttpEntity<>(map, new HttpHeaders());
        String rawResponse = restTemplate.postForObject(keycloakTokenUri, request, String.class);

        // Paso 2: Obtener el access_token del JSON
        ObjectMapper mapper = new ObjectMapper();
        JsonNode responseJson = mapper.readTree(rawResponse);
        String accessToken = responseJson.get("access_token").asText();

        // Paso 3: Extraer datos del token
        UserSessionInfo userInfo = extractUserInfoFromToken(accessToken);

        // Paso 4: Construir respuesta
        LoginResponse loginResponse = new LoginResponse();
        loginResponse.setToken(accessToken);
        loginResponse.setUser(userInfo);

        return loginResponse;
    }

    /**
     * Create a new user in Keycloak.
     *
     * @param username  the username
     * @param email     the email
     * @param firstName the first name
     * @param lastName  the last name
     * @param password  the password
     * @throws Exception the exception
     */
    public String createUser(String username, String email, String firstName, String lastName, String password)
            throws Exception {
        // Obtener el token de administración para el usuario con rol ADMINISTRADOR en
        // el reino Puntometro
        String adminToken = getAdminAccessToken();

        // Construir el cuerpo de la solicitud para crear el usuario
        Map<String, Object> user = new HashMap<>();
        user.put("username", username);
        user.put("email", email);
        user.put("firstName", firstName);
        user.put("lastName", lastName);
        user.put("enabled", true);

        Map<String, Object> credentials = new HashMap<>();
        credentials.put("type", "password");
        credentials.put("value", password);
        credentials.put("temporary", false);
        user.put("credentials", Collections.singletonList(credentials));

        HttpHeaders headers = new HttpHeaders();
        headers.set("Authorization", "Bearer " + adminToken);
        headers.set("Content-Type", "application/json");

        HttpEntity<Map<String, Object>> request = new HttpEntity<>(user, headers);

        // Imprimir la URL completa para verificación
        String createUserUrl = keycloakBaseUri + "/admin/realms/Comisiones/users";
        System.out.println("Creating user at URL: " + createUserUrl);

        try {
            ResponseEntity<String> response = restTemplate.exchange(
                    createUserUrl,
                    HttpMethod.POST,
                    request,
                    String.class);
            return response.getBody();
        } catch (HttpClientErrorException e) {
            System.err.println("Error creating user: " + e.getResponseBodyAsString());
            throw new Exception("Error creating user: " + e.getResponseBodyAsString());
        }
    }

    /**
     * Get an access token for the user with the role ADMINISTRATOR in the
     * Comisiones realm.
     *
     * @return the admin token
     */
    private String getAdminAccessToken() throws Exception {
        String masterTokenUrl = keycloakBaseUri + "/realms/master/protocol/openid-connect/token";

        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_FORM_URLENCODED);

        MultiValueMap<String, String> body = new LinkedMultiValueMap<>();
        body.add("grant_type", "password");
        body.add("client_id", "admin-cli");
        body.add("username", adminUsername);
        body.add("password", adminPassword);

        HttpEntity<MultiValueMap<String, String>> entity = new HttpEntity<>(body, headers);

        ResponseEntity<Map> response = restTemplate.postForEntity(masterTokenUrl, entity, Map.class);

        Map<String, String> responseBody = response.getBody();
        String accessToken = responseBody != null ? responseBody.get("access_token") : null;

        if (accessToken == null) {
            throw new Exception("Access token is null or empty");
        }

        return accessToken;
    }

    public void setKeycloakBaseUri(String baseUri) {
        this.keycloakBaseUri = baseUri;
    }

    public void sendVerificationCode(String email, String code) {
        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_JSON); // Mantenemos JSON para el envío de datos

        // Construir el cuerpo del correo electrónico
        String subject = "Código de verificación para restablecer contraseña";
        String body = "Hola estimad@,\n\n"
                + "Has solicitado restablecer tu contraseña en nuestra plataforma.\n\n"
                + "Tu código de verificación es: " + code + "\n\n"
                + "Para restablecer tu contraseña, haz clic en el siguiente enlace:\n"
                + resetPasswordUrl + "\n\n"
                + "Si no has solicitado este cambio, ignora este mensaje.\n\n"
                + "Saludos,\n"
                + "Equipo de Soporte";

        // Preparar el contenido del correo electrónico
        Map<String, Object> emailContent = new HashMap<>();
        emailContent.put("destinatarios", Collections.singletonList(email));
        emailContent.put("asunto", subject);
        emailContent.put("cuerpo", body);

        HttpEntity<Map<String, Object>> request = new HttpEntity<>(emailContent, headers);

        try {
            restTemplate.postForEntity(emailServiceUri + "/enviar-correo", request, String.class);
        } catch (HttpClientErrorException e) {
            System.err.println("Error al enviar el código de verificación: " + e.getStatusCode() + " - "
                    + e.getResponseBodyAsString());
            throw new RuntimeException("Error al enviar el código de verificación: " + e.getStatusCode() + " - "
                    + e.getResponseBodyAsString());
        } catch (RestClientException e) {
            System.err.println("RestClientException: " + e.getMessage());
            throw new RuntimeException("RestClientException: " + e.getMessage());
        }
    }

    // Método para generar un código de verificación de 4 dígitos
    public String generateVerificationCode() {
        Random random = new Random();
        int option = random.nextInt(2); // Genera un número aleatorio entre 0 y 1

        if (option == 0) {
            // Generar cuatro números aleatorios
            int code = 1000 + random.nextInt(9000);
            return String.valueOf(code);
        } else {
            // Generar dos letras seguidas de dos números
            String letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
            StringBuilder sb = new StringBuilder();

            // Generar dos letras aleatorias
            for (int i = 0; i < 2; i++) {
                sb.append(letters.charAt(random.nextInt(letters.length())));
            }

            // Generar dos números aleatorios
            int numbers = 1000 + random.nextInt(9000);
            sb.append(numbers);

            return sb.toString();
        }
    }

    // Método para enviar el código de verificación por correo
    public void forgotPassword(String email) {
        String code = generateVerificationCode();
        sendVerificationCode(email, code);
        verificationCodes.put(email, code);
    }

    // Método para restablecer la contraseña
    public void resetPassword(String email, String code, String newPassword) throws Exception {
        String storedCode = verificationCodes.get(email);
        if (storedCode != null && storedCode.equals(code)) {
            String userId = getUserIdByEmail(email);
            updatePassword(userId, newPassword);
            verificationCodes.remove(email);
        } else {
            throw new IllegalArgumentException("Código de verificación no válido");
        }
    }

    private String getUserIdByEmail(String email) throws Exception {
        String token = getAdminAccessToken();

        HttpHeaders headers = new HttpHeaders();
        headers.setBearerAuth(token);
        headers.setContentType(MediaType.APPLICATION_JSON);

        HttpEntity<Void> entity = new HttpEntity<>(headers);
        String url = keycloakBaseUri + "/admin/realms/Comisiones/users?email=" + email;

        ResponseEntity<JsonNode> response = restTemplate.exchange(url, HttpMethod.GET, entity, JsonNode.class);

        if (response.getBody() != null && response.getBody().size() > 0) {
            return response.getBody().get(0).get("id").asText();
        } else {
            throw new Exception("Usuario no encontrado");
        }
    }

    private void updatePassword(String userId, String newPassword) throws Exception {
        String token = getAdminAccessToken();

        HttpHeaders headers = new HttpHeaders();
        headers.setBearerAuth(token);
        headers.setContentType(MediaType.APPLICATION_JSON);

        Map<String, Object> credentials = new HashMap<>();
        credentials.put("type", "password");
        credentials.put("value", newPassword);
        credentials.put("temporary", false);

        HttpEntity<Map<String, Object>> entity = new HttpEntity<>(credentials, headers);
        String url = keycloakBaseUri + "/admin/realms/Comisiones/users/" + userId + "/reset-password";

        restTemplate.put(url, entity);
    }

    public boolean isEmailRegisteredInRealm(String email, String realmName) {
        String url = keycloakBaseUri + "/admin/realms/" + realmName + "/users";
        ResponseEntity<String> response = restTemplate.getForEntity(url + "?email=" + email, String.class);
        return response.getStatusCode().is2xxSuccessful();
    }

    public boolean checkEmailExists(String email) throws Exception {
        String accessToken = getAdminAccessToken();

        HttpHeaders headers = new HttpHeaders();
        headers.setBearerAuth(accessToken);

        UriComponentsBuilder builder = UriComponentsBuilder
                .fromHttpUrl(keycloakBaseUri + "/admin/realms/Comisiones/users")
                .queryParam("email", email);

        HttpEntity<String> entity = new HttpEntity<>(headers);

        ResponseEntity<Map[]> response = restTemplate.exchange(
                builder.toUriString(),
                HttpMethod.GET,
                entity,
                Map[].class);

        Map[] users = response.getBody();
        return users != null && users.length > 0;
    }
 // NUEVA CONFIGURACIÓN PARA EXTRAER ROLES POR EMPRESA

    public UserSessionInfo extractUserInfoFromToken(String accessToken) {
        try {
            String[] chunks = accessToken.split("\\.");
            if (chunks.length < 2) {
                throw new IllegalArgumentException("Token inválido");
            }

            String payload = new String(Base64.getUrlDecoder().decode(chunks[1]), StandardCharsets.UTF_8);
            ObjectMapper mapper = new ObjectMapper();
            JsonNode tokenData = mapper.readTree(payload);

            UserSessionInfo info = new UserSessionInfo();
            info.setUsername(tokenData.path("preferred_username").asText());
            info.setEmail(tokenData.path("email").asText());

            JsonNode resourceAccess = tokenData.path("resource_access");
            if (resourceAccess.isMissingNode() || resourceAccess.isNull()) {
                throw new RuntimeException("resource_access no está presente en el token.");
            }

            // Tomar SOLO el cliente exacto indicado en properties
            JsonNode clientNode = resourceAccess.path(clientId);
            if (clientNode.isMissingNode() || clientNode.isNull()) {
                throw new RuntimeException(
                        "El clientId '" + clientId + "' no está presente en resource_access del token.");
            }

            JsonNode rolesNode = clientNode.path("roles");
            List<String> roles = new ArrayList<>();
            if (rolesNode.isArray()) {
                for (JsonNode r : rolesNode) {
                    roles.add(r.asText());
                }
            }

            // Mantengo tu estructura: map por “empresa”.
            // Como ahora solo usamos el clientId exacto, usamos el propio clientId como
            // clave.
            Map<String, List<String>> rolesPorEmpresa = new HashMap<>();
            if (!roles.isEmpty()) {
                rolesPorEmpresa.put(clientId.toUpperCase(), roles);
            }

            info.setRolesPorEmpresa(rolesPorEmpresa);
            return info;

        } catch (Exception e) {
            e.printStackTrace();
            throw new RuntimeException("Error al extraer roles por cliente del token: " + e.getMessage(), e);
        }
    }
}