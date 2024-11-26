# Security

This document outlines a minimal configuration for setting up a CodePush standalone server, primarily intended for demonstration purposes. Please note that for a production environment, additional security measures are necessary to protect the system against potential threats. The recommendations provided here should be treated as guidelines and not an exhaustive security manual.

## Implementing DDoS Protection

By design, CodePush can handle a large volume of requests from mobile devices. DDoS (Distributed Denial of Service) protection is a critical component to ensure the availability and stability of your service. However, this setup does not include comprehensive DDoS protection. It is the customer's responsibility to implement appropriate measures.

## Proper Secret Management

All secrets used in the system should be handled with the utmost care. They must be stored securely and accessible only to authorized consumers. The proper management of secrets is beyond the scope of this document and is the responsibility of the customer.

## Adopting Security Best Practices for System Components

It is essential to review and apply security best practices for all system components. As this setup is minimal, it is the customer’s responsibility to harden the system for production use.
