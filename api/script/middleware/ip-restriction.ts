import { Request, Response, NextFunction } from 'express';

interface IpRestrictionConfig {
  allowedIps: string[];
  restrictedPaths: string[];
}

export const createIpRestrictionMiddleware = (config: IpRestrictionConfig) => {
  return (req: Request, res: Response, next: NextFunction) => {
    // Check if the current path should be restricted
    const shouldRestrict = config.restrictedPaths.some(path => 
      req.path.toLowerCase().startsWith(path.toLowerCase())
    );

    if (shouldRestrict) {
      const clientIp = req.ip || 
                      req.connection.remoteAddress || 
                      req.socket.remoteAddress ||
                      (req.connection && req.connection['forwardedAddress']);

      // Remove IPv6 prefix if present
      const normalizedClientIp = clientIp?.replace(/^::ffff:/, '');
      
      // Check if client IP is in allowed list
      const isAllowed = config.allowedIps.some(ip => {
        // Handle CIDR notation
        if (ip.includes('/')) {
          return isIpInCidr(normalizedClientIp, ip);
        }
        return ip === normalizedClientIp;
      });

      if (!isAllowed) {
        console.log(`Access denied for IP ${normalizedClientIp} to ${req.path}`);
        return res.status(403).json({
          message: 'Access denied. Your IP is not whitelisted.'
        });
      }
    }

    next();
  };
};

// Helper function to check if an IP is in a CIDR range
function isIpInCidr(ip: string, cidr: string): boolean {
  const [range, bits = "32"] = cidr.split("/");
  const mask = ~((1 << (32 - parseInt(bits))) - 1);
  
  const ipParts = ip.split(".").map(part => parseInt(part));
  const rangeParts = range.split(".").map(part => parseInt(part));
  
  const ipNum = ipParts.reduce((sum, part, i) => sum + (part << (24 - (i * 8))), 0);
  const rangeNum = rangeParts.reduce((sum, part, i) => sum + (part << (24 - (i * 8))), 0);
  
  return (ipNum & mask) === (rangeNum & mask);
}