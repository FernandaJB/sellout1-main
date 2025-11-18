package com.sellout.controller;

import com.sellout.models.LoginRequest;
import com.sellout.models.LoginResponse;
import com.sellout.models.UserRegistrationRequest;
import com.sellout.service.KeycloakRestService;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.auth0.jwk.Jwk;
import com.auth0.jwt.JWT;
import com.auth0.jwt.algorithms.Algorithm;
import com.auth0.jwt.interfaces.DecodedJWT;
import com.sellout.exception.BussinesRuleException;
import com.sellout.service.JwtService;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;

import org.springframework.web.bind.annotation.*;

import java.security.interfaces.RSAPublicKey;
import java.util.*;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;

@RestController
@RequestMapping("/api-keycloak/security")
public class IndexController {

    private Logger logger = LoggerFactory.getLogger(IndexController.class);

    @Autowired
    private KeycloakRestService restService;

    @Autowired
    private JwtService jwtService;

    @GetMapping("/roles")
    public ResponseEntity<?> getRoles(@RequestHeader("Authorization") String authHeader) throws BussinesRuleException {
        try {
            DecodedJWT jwt = JWT.decode(authHeader.replace("Bearer", "").trim());

            // check JWT is valid
            Jwk jwk = jwtService.getJwk();
            Algorithm algorithm = Algorithm.RSA256((RSAPublicKey) jwk.getPublicKey(), null);

            algorithm.verify(jwt);

            // check JWT role is correct
            List<String> roles = ((List) jwt.getClaim("realm_access").asMap().get("roles"));

            // check JWT is still active
            Date expiryDate = jwt.getExpiresAt();
            if (expiryDate.before(new Date())) {
                throw new Exception("token is expired");
            }
            // all validation passed
            HashMap<String, Integer> roleMap = new HashMap<>();
            for (String str : roles) {
                roleMap.put(str, str.length());
            }
            return ResponseEntity.ok(roleMap);
        } catch (Exception e) {
            logger.error("exception : {} ", e.getMessage());
            throw new BussinesRuleException("01", e.getMessage(), HttpStatus.FORBIDDEN);
        }
    }

    @SuppressWarnings("unchecked")
    @GetMapping("/valid")
    public ResponseEntity<?> valid(@RequestHeader("Authorization") String authHeader) throws BussinesRuleException {
        try {
            restService.checkValidity(authHeader);
            return ResponseEntity.ok(new HashMap<String, String>() {
                {
                    put("is_valid", "true");
                }
            });
        } catch (Exception e) {
            logger.error("token is not valid, exception : {} ", e.getMessage());
            throw new BussinesRuleException("is_valid", "False", HttpStatus.FORBIDDEN);
        }
    }

    @PostMapping(value = "/login", produces = MediaType.APPLICATION_JSON_VALUE)
    public ResponseEntity<?> login(String username, String password) {
        String loginResponse = restService.login(username, password);

        try {
            // Convertir la respuesta a un objeto JSON
            ObjectMapper mapper = new ObjectMapper();
            JsonNode responseJson = mapper.readTree(loginResponse);

            // Extraer el token de acceso
            String accessToken = responseJson.get("access_token").asText();

            // Decodificar el token para obtener información del usuario
            DecodedJWT jwt = JWT.decode(accessToken);

            // Extraer información relevante
            String userId = jwt.getSubject();
            String userName = jwt.getClaim("preferred_username").asString();
            String email = jwt.getClaim("email").asString();
            List<String> roles = ((List) jwt.getClaim("realm_access").asMap().get("roles"));

            // Crear un objeto con la información del usuario y el token original
            Map<String, Object> result = new HashMap<>();
            result.put("token_response", mapper.readValue(loginResponse, Map.class));
            result.put("user_info", new HashMap<String, Object>() {
                {
                    put("user_id", userId);
                    put("username", userName);
                    put("email", email);
                    put("roles", roles);
                }
            });

            return ResponseEntity.ok(result);
        } catch (Exception e) {
            // Si hay algún error, devolver la respuesta original
            return ResponseEntity.ok(loginResponse);
        }
    }

    @PostMapping(value = "/logout", produces = MediaType.APPLICATION_JSON_VALUE)
    public ResponseEntity<?> logout(@RequestParam(value = "refresh_token", name = "refresh_token") String refreshToken)
            throws BussinesRuleException {
        try {
            restService.logout(refreshToken);
            return ResponseEntity.ok(new HashMap<String, String>() {
                {
                    put("logout", "true");
                }
            });
        } catch (Exception e) {
            logger.error("unable to logout, exception : {} ", e.getMessage());
            throw new BussinesRuleException("logout", "False", HttpStatus.FORBIDDEN);
        }
    }

    @PostMapping(value = "/refresh", produces = MediaType.APPLICATION_JSON_VALUE)
    public ResponseEntity<?> refresh(@RequestParam(value = "refresh_token", name = "refresh_token") String refreshToken)
            throws BussinesRuleException {
        try {
            return ResponseEntity.ok(restService.refresh(refreshToken));
        } catch (Exception e) {
            logger.error("unable to refresh, exception : {} ", e.getMessage());
            throw new BussinesRuleException("refresh", "False", HttpStatus.FORBIDDEN);
        }
    }

    @PostMapping("/register")
    public ResponseEntity<String> registerUser(@RequestBody UserRegistrationRequest request) {
        try {
            if (!request.getPassword().equals(request.getConfirmPassword())) {
                return ResponseEntity.badRequest().body("Passwords do not match");
            }
            // Cambiar la URL base para apuntar al reino "Puntometro"
            restService.setKeycloakBaseUri("http://192.168.246.246:9090");
            restService.createUser(
                    request.getUsername(),
                    request.getEmail(),
                    request.getFirstName(),
                    request.getLastName(),
                    request.getPassword());
            return ResponseEntity.ok("User registered successfully");
        } catch (Exception e) {
            return ResponseEntity.status(500).body("Error registering user: " + e.getMessage());
        }
    }

    @PostMapping("/forgotPassword")
    public ResponseEntity<?> forgotPassword(@RequestBody Map<String, String> request) {
        String email = request.get("email");

        try {
            // Cambiar la URL base para apuntar al reino "Puntometro"
            restService.setKeycloakBaseUri("http://192.168.246.246:9090");

            // Verificar si el email existe en el reino "Puntometro"
            boolean emailExists = restService.checkEmailExists(email);

            if (!emailExists) {
                return ResponseEntity.status(HttpStatus.NOT_FOUND).body("Correo no exite en el sistema");
            }

            // Llamar al método en KeycloakRestService para enviar el código de verificación
            restService.forgotPassword(email);

            return ResponseEntity.ok("Validacion de codigo enviado");
        } catch (Exception e) {
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).body("Error sending verification code");
        }
    }

    @PostMapping("/resetPassword")
    public ResponseEntity<String> resetPassword(@RequestParam String email, @RequestParam String code,
            @RequestParam String newPassword, @RequestParam String confirmPassword) {
        try {
            // Verificar si la nueva contraseña coincide con la confirmación
            if (!newPassword.equals(confirmPassword)) {
                return ResponseEntity.badRequest().body("Passwords do not match");
            }

            // Cambiar la URL base para apuntar al reino "Puntometro"
            restService.setKeycloakBaseUri("http://192.168.246.246:9090");

            // Llamar al método en KeycloakRestService para resetear la contraseña
            restService.resetPassword(email, code, newPassword);

            return ResponseEntity.ok("Password reset successfully");
        } catch (Exception e) {
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                    .body("Error resetting password: " + e.getMessage());
        }
    }

    @GetMapping("/checkEmailExists")
    public ResponseEntity<Boolean> checkEmailExists(@RequestParam String email) {
        try {
            // Cambiar la URL base para apuntar al reino "Puntometro"
            restService.setKeycloakBaseUri("http://192.168.246.246:9090");
            // Verificar si el email existe en el reino "Puntometro"
            boolean emailExists = restService.checkEmailExists(email);

            return ResponseEntity.ok(emailExists);
        } catch (Exception e) {
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).body(false);
        }
    }

    @PostMapping("/loginPrueba")
    public ResponseEntity<LoginResponse> login(@RequestBody LoginRequest request) throws Exception {
        LoginResponse response = restService.loginWithUserInfo(request.getUsername(), request.getPassword());
        return ResponseEntity.ok(response);
    }

}
