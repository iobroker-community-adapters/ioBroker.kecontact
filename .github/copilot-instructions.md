# ioBroker Adapter Development with GitHub Copilot

**Version:** 0.4.0
**Template Source:** https://github.com/DrozmotiX/ioBroker-Copilot-Instructions

This file contains instructions and best practices for GitHub Copilot when working on ioBroker adapter development.

## Project Context

You are working on an ioBroker adapter. ioBroker is an integration platform for the Internet of Things, focused on building smart home and industrial IoT solutions. Adapters are plugins that connect ioBroker to external systems, devices, or services.

### Adapter-Specific Context: KEBA KeContact Wallbox Controller

This adapter controls KEBA KeContact P20/P30 and BMW i wallboxes through UDP communication protocol. Key features and requirements:

- **Primary Function**: Electric vehicle charging station control and monitoring
- **Communication Protocol**: UDP sockets (port 7090 for commands, 7092 for broadcasts)
- **Key Features**: 
  - Automatic regulation based on photovoltaic surplus and battery storage
  - Real-time monitoring of charging status, current, and energy consumption
  - Support for different wallbox models (P20, P30, BMW i wallbox)
  - Power limitation and automatic charging strategies
- **Hardware Models**: Supports multiple KEBA KeContact series (A, B, C, E, X, D-Edition) and BMW wallboxes
- **Configuration Requirements**: IP address, energy meter states for PV automation, battery storage parameters
- **External Dependencies**: Direct UDP communication with physical wallbox hardware, potential HTTP requests for firmware checking

## Testing

### Unit Testing
- Use Jest as the primary testing framework for ioBroker adapters
- Create tests for all adapter main functions and helper methods
- Test error handling scenarios and edge cases
- Mock external API calls and hardware dependencies
- For adapters connecting to APIs/devices not reachable by internet, provide example data files to allow testing of functionality without live connections
- Example test structure:
  ```javascript
  describe('AdapterName', () => {
    let adapter;
    
    beforeEach(() => {
      // Setup test adapter instance
    });
    
    test('should initialize correctly', () => {
      // Test adapter initialization
    });
  });
  ```

### Integration Testing

**IMPORTANT**: Use the official `@iobroker/testing` framework for all integration tests. This is the ONLY correct way to test ioBroker adapters.

**Official Documentation**: https://github.com/ioBroker/testing

#### Framework Structure
Integration tests MUST follow this exact pattern:

```javascript
const path = require('path');
const { tests } = require('@iobroker/testing');

// Define test coordinates or configuration
const TEST_COORDINATES = '52.520008,13.404954'; // Berlin
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

// Use tests.integration() with defineAdditionalTests
tests.integration(path.join(__dirname, '..'), {
    defineAdditionalTests({ suite }) {
        suite('Test adapter with specific configuration', (getHarness) => {
            let harness;

            before(() => {
                harness = getHarness();
            });

            it('should configure and start adapter', function () {
                return new Promise(async (resolve, reject) => {
                    try {
                        harness = getHarness();
                        
                        // Get adapter object using promisified pattern
                        const obj = await new Promise((res, rej) => {
                            harness.objects.getObject('system.adapter.your-adapter.0', (err, o) => {
                                if (err) return rej(err);
                                res(o);
                            });
                        });
                        
                        if (!obj) {
                            return reject(new Error('Adapter object not found'));
                        }

                        // Configure adapter properties
                        Object.assign(obj.native, {
                            position: TEST_COORDINATES,
                            createCurrently: true,
                            createHourly: true,
                            createDaily: true,
                            // Add other configuration as needed
                        });

                        // Set the updated configuration
                        harness.objects.setObject(obj._id, obj);

                        console.log('✅ Step 1: Configuration written, starting adapter...');
                        
                        // Start adapter and wait
                        await harness.startAdapterAndWait();
                        
                        console.log('✅ Step 2: Adapter started');

                        // Wait for adapter to process data
                        const waitMs = 15000;
                        await wait(waitMs);

                        console.log('🔍 Step 3: Checking states after adapter run...');
                        
                        // Check specific states created by your adapter
                        const connectionState = await harness.states.getStateAsync('your-adapter.0.info.connection');
                        
                        if (!connectionState) {
                            return reject(new Error('Connection state not found - adapter may not have started properly'));
                        }

                        console.log('✅ Step 4: Integration test completed successfully');
                        resolve();

                    } catch (error) {
                        console.error('❌ Integration test failed:', error);
                        reject(error);
                    }
                });
            }).timeout(60000);
        });
    }
});
```

### Testing UDP Communication (Kecontact-Specific)
For testing UDP socket functionality in the kecontact adapter:

```javascript
// Mock UDP socket for unit tests
const mockSocket = {
    bind: jest.fn((callback) => callback && callback()),
    close: jest.fn((callback) => callback && callback()),
    send: jest.fn((buffer, port, address, callback) => callback && callback()),
    on: jest.fn()
};

describe('Kecontact UDP Communication', () => {
    beforeEach(() => {
        // Mock dgram module
        jest.doMock('dgram', () => ({
            createSocket: jest.fn(() => mockSocket)
        }));
    });

    test('should create UDP sockets for communication', () => {
        // Test UDP socket creation and configuration
    });

    test('should handle UDP message parsing correctly', () => {
        // Test parsing of wallbox UDP responses
    });
});
```

## Adapter Patterns for ioBroker

### State Management
- Always check if objects exist before setting values: `setObjectNotExistsAsync()`
- Use appropriate data types and roles in object definitions
- Implement proper state change handlers with `on('stateChange', ...)`
- Clean up state change listeners in `unload()` method

### Logging Standards
- Use appropriate log levels: `error`, `warn`, `info`, `debug`
- Include context in log messages (device ID, state name, etc.)
- Debug log sensitive information only (IP addresses, tokens)
- Log state changes only when necessary to avoid spam

### Configuration Validation
Always validate adapter configuration in `checkConfig()` method:

```javascript
checkConfig() {
    let everythingFine = true;
    
    if (!this.config.ipaddress) {
        this.log.error('IP address is missing in configuration');
        everythingFine = false;
    }
    
    // Validate required configuration parameters
    return everythingFine;
}
```

### Connection Management
- Implement proper connection timeouts and error handling
- Use connection state indicators (`info.connection`)
- Gracefully handle device disconnections and reconnections
- Clean up network resources in `unload()` method

### ioBroker Lifecycle Methods

#### `onReady()`
- Validate configuration using `checkConfig()`
- Initialize external connections (HTTP clients, serial ports, etc.)
- Set up timers and intervals
- Create required objects and states
- Set adapter status to connected when ready

#### `onStateChange(id, state)`
- Handle user input from ioBroker states
- Validate state changes before processing
- Implement command queuing if needed
- Update external devices/services

#### `onMessage(obj)`
- Handle admin interface communications
- Implement device discovery if applicable
- Process configuration tests

#### `unload(callback)`
- Close all external connections (HTTP, serial, UDP sockets, etc.)
- Clear all timers and intervals
- Clean up resources
- Set connection state to false
- Call callback when done

### Device Communication Patterns

#### UDP Communication (Kecontact-specific)
```javascript
// Example UDP socket setup for kecontact wallbox
setupUDPSockets() {
    this.txSocket = dgram.createSocket('udp4');
    this.rxSocketReports = dgram.createSocket('udp4');
    this.rxSocketBroadcast = dgram.createSocket('udp4');

    // Bind sockets with proper error handling
    this.rxSocketReports.bind(this.DEFAULT_UDP_PORT, () => {
        this.log.debug('UDP report socket bound to port ' + this.DEFAULT_UDP_PORT);
    });

    this.rxSocketBroadcast.bind(this.BROADCAST_UDP_PORT, () => {
        this.log.debug('UDP broadcast socket bound to port ' + this.BROADCAST_UDP_PORT);
    });

    // Set up message handlers
    this.rxSocketReports.on('message', (msg, rinfo) => {
        this.processUDPMessage(msg, rinfo);
    });
}

// Clean up UDP sockets in unload
unload(callback) {
    if (this.txSocket) {
        this.txSocket.close();
        this.txSocket = null;
    }
    if (this.rxSocketReports) {
        this.rxSocketReports.close();
        this.rxSocketReports = null;
    }
    if (this.rxSocketBroadcast) {
        this.rxSocketBroadcast.close();
        this.rxSocketBroadcast = null;
    }
    callback();
}
```

#### HTTP API Communication
```javascript
async makeHttpRequest(url, options = {}) {
    try {
        const response = await axios.get(url, {
            timeout: 5000,
            ...options
        });
        return response.data;
    } catch (error) {
        this.log.warn(`HTTP request failed: ${error.message}`);
        throw error;
    }
}
```

### Error Handling
- Always wrap async operations in try-catch blocks
- Provide meaningful error messages to users
- Don't crash the adapter on recoverable errors
- Log errors with appropriate severity levels
- Implement retry logic for transient failures

### Data Validation and Sanitization
- Validate all external data before processing
- Sanitize user inputs from state changes
- Check data types and ranges
- Handle missing or malformed data gracefully

## Code Style and Standards

- Follow JavaScript/TypeScript best practices
- Use async/await for asynchronous operations
- Implement proper resource cleanup in `unload()` method
- Use semantic versioning for adapter releases
- Include proper JSDoc comments for public methods

## CI/CD and Testing Integration

### GitHub Actions for API Testing
For adapters with external API dependencies, implement separate CI/CD jobs:

```yaml
# Tests API connectivity with demo credentials (runs separately)
demo-api-tests:
  if: contains(github.event.head_commit.message, '[skip ci]') == false
  
  runs-on: ubuntu-22.04
  
  steps:
    - name: Checkout code
      uses: actions/checkout@v4
      
    - name: Use Node.js 20.x
      uses: actions/setup-node@v4
      with:
        node-version: 20.x
        cache: 'npm'
        
    - name: Install dependencies
      run: npm ci
      
    - name: Run demo API tests
      run: npm run test:integration-demo
```

### CI/CD Best Practices
- Run credential tests separately from main test suite
- Use ubuntu-22.04 for consistency
- Don't make credential tests required for deployment
- Provide clear failure messages for API connectivity issues
- Use appropriate timeouts for external API calls (120+ seconds)

### Package.json Script Integration
Add dedicated script for credential testing:
```json
{
  "scripts": {
    "test:integration-demo": "mocha test/integration-demo --exit"
  }
}
```

### Practical Example: Complete API Testing Implementation
Here's a complete example based on lessons learned from the Discovergy adapter:

#### test/integration-demo.js
```javascript
const path = require("path");
const { tests } = require("@iobroker/testing");

// Helper function to encrypt password using ioBroker's encryption method
async function encryptPassword(harness, password) {
    const systemConfig = await harness.objects.getObjectAsync("system.config");
    
    if (!systemConfig || !systemConfig.native || !systemConfig.native.secret) {
        throw new Error("Could not retrieve system secret for password encryption");
    }
    
    const secret = systemConfig.native.secret;
    let result = '';
    for (let i = 0; i < password.length; ++i) {
        result += String.fromCharCode(secret[i % secret.length].charCodeAt(0) ^ password.charCodeAt(i));
    }
    
    return result;
}

// Run integration tests with demo credentials
tests.integration(path.join(__dirname, ".."), {
    defineAdditionalTests({ suite }) {
        suite("API Testing with Demo Credentials", (getHarness) => {
            let harness;
            
            before(() => {
                harness = getHarness();
            });

            it("Should connect to API and initialize with demo credentials", async () => {
                console.log("Setting up demo credentials...");
                
                if (harness.isAdapterRunning()) {
                    await harness.stopAdapter();
                }
                
                const encryptedPassword = await encryptPassword(harness, "demo_password");
                
                await harness.changeAdapterConfig("your-adapter", {
                    native: {
                        username: "demo@provider.com",
                        password: encryptedPassword,
                        // other config options
                    }
                });

                console.log("Starting adapter with demo credentials...");
                await harness.startAdapter();
                
                // Wait for API calls and initialization
                await new Promise(resolve => setTimeout(resolve, 60000));
                
                const connectionState = await harness.states.getStateAsync("your-adapter.0.info.connection");
                
                if (connectionState && connectionState.val === true) {
                    console.log("✅ SUCCESS: API connection established");
                    return true;
                } else {
                    throw new Error("API Test Failed: Expected API connection to be established with demo credentials. " +
                        "Check logs above for specific API errors (DNS resolution, 401 Unauthorized, network issues, etc.)");
                }
            }).timeout(120000);
        });
    }
});
```

### Kecontact-Specific Development Guidelines

#### Wallbox Communication Protocol
- Always implement proper UDP socket error handling and timeouts
- Use command queuing to prevent overwhelming the wallbox
- Implement proper parsing for different wallbox response formats
- Handle different wallbox models (P20, P30, BMW i wallbox) with their specific capabilities
- Validate wallbox responses before processing state updates

#### PV Automation Logic
- Implement safe charging current calculations based on available power
- Consider battery storage state and configuration in automation decisions
- Provide clear logging for automatic regulation decisions
- Implement proper bounds checking for charging current limits
- Handle grid consumption measurements and power meter integration

#### State Management for Energy Data
- Use appropriate units and roles for energy-related states (Wh, kWh, A, V, W)
- Implement proper history logging for energy consumption data
- Create meaningful state descriptions and translations
- Handle missing or invalid energy meter data gracefully

#### Configuration Validation
- Validate IP addresses and network connectivity
- Check foreign state references for energy meters and battery systems
- Implement proper error messages for invalid PV automation settings
- Validate charging current limits against wallbox capabilities