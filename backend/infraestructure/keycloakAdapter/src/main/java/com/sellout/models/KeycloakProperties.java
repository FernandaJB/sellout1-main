package com.sellout.models;

import java.util.HashMap;
import java.util.Map;

import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.stereotype.Component;

import lombok.Data;

@Data
@Component
@ConfigurationProperties(prefix = "keycloak")
public class KeycloakProperties {
    private String baseUri;
    private String jwkSetUri;
    private String userInfoUri;
    private String logoutUri;
    private String emailServiceUri;
    private String resetPasswordUrl;
    private String defaultApp = "sellout";
    private String claimName = "appName";
    
    private Client sellout;
    private Admin admin;
    
    @Data
    public static class Client {
        private String clientId;
        private String clientSecret;
        private String tokenUri;
        private String jwkSetUri;
         private String certsId;
    }

    private Map<String, Client> clients = new HashMap<>();
    
    @Data
    public static class Admin {
        private String clientId;
        private String username;
        private String password;
    }
}