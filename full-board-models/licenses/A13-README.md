# Allwinner A13 Board

![board_render](/assets/front.png)

## Description

Board overview (draft):
[TBD]


### Features


| Characteristic | Description |
| --- | --- |
| Dimensions | 80mm x 40mm |
| Processor | Allwinner A13 (ARM Cortex-A8 @ 1Ghz) |
| Oscillators |  24MHz main clock |
| RAM | DDR3 512MB max (8Gbit module) |
| Storage | microSD |
| USB | 1 microUSB OTG |
| Ethernet | N/A |
| WiFi/BT | RTL8188CUS module |
| LCD | Parallel interface 18bit |
| Expansions | 1xUART, 1xI2C, 1xSPI, 4xGPIO, Microphone, EarphoneOut |
| Supply | Power path between USB/ACIN/Battery, 5V max |

### Expansions
 The board can be combined with several predefined capes that add functionality.
 * [LCD cape](https://github.com/vd-rd/hw_cape_lcd) can be used to add a 3inch LCD/Touch with 800x480px resolution.
 * [GPS cape](https://github.com/vd-rd/hw_cape_gps) adds GPS/GNSS/GLONAS capabilities
 * [GSM cape](https://github.com/vd-rd/hw_cape_gsm) adds GPRS connectivity. 


### Power considerations

A13 features a few power rails:
* VDD-CPU - TBD - from AXP209
* VDD-INT - 1.2V - from DCDC
* VDD-GPIO - 3V3 - from AXP209
* VDD-DRAM - 1V5 - from DCDC
* AVCC - 3V - from AXP209

The datasheet states that AVCC and VDD-DRAM must be present at all times (even standby).
VDD-INT and VDD-CPU can't be tied together because VDD-CPU is DVS enabled.


### Memory considerations

A13 DRAM controller doesn't provide DDR-CS. On the memory side the pin is tied to GND.
Memory tuning should be performed as [described here](https://linux-sunxi.org/A10_DRAM_Controller_Calibration)


### Building and flashing

Build U-Boot and Linux kernel + rootFS - TBD

Flash to SDCard - TBD

 
### Resources

You can find all necesary information to build or evaluate the module here:
   - [Fabrication files](https://github.com/vd-rd/sbc_alw_a13/releases)

Inspiration for this has been drawn from:
* Olimex boards 
* Sunxi community

