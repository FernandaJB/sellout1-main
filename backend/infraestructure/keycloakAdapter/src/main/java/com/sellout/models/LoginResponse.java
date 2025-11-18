package com.sellout.models;

import lombok.Data;

@Data
public class LoginResponse {
    
    private String token;
    private UserSessionInfo user;

}
