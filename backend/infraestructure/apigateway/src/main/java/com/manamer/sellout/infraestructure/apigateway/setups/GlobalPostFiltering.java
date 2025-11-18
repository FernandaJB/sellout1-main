package com.manamer.sellout.infraestructure.apigateway.setups;

import org.springframework.cloud.gateway.filter.GlobalFilter;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import reactor.core.publisher.Mono;
import lombok.extern.slf4j.Slf4j;


@Configuration
@Slf4j
public class GlobalPostFiltering {

    @Bean
    public GlobalFilter postGlobalFilter() {
        return (exchange, chain) -> {
            return chain.filter(exchange)
                .then(Mono.fromRunnable(()-> {
                    log.info("*************Global post  Filter executed***********************");
                }));
        };
    }

}
