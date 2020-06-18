// Dictionary (systemDictionary is global variable from adapter-settings.js)
systemDictionary = {
    "KEBA KeContact adapter settings": {
        "en": "KEBA KeContact adapter settings",
        "de": "KEBA KeContact Adapter-Einstellungen",
        "ru": "Настройки драйвера KEBA KeContact"
    },
    "KeContact IP Address": {
        "en": "Wallbox IP Address", 
        "de": "IP-Adresse der Wallbox", 
        "ru": "IP Минисервера KeContact"
    },
    "passive mode": {
        "en": "passive mode",
        "de": "passiver Modus"
    },
    "Refresh Interval": {
        "en": "Refresh Interval",
        "de": "Aktualisierungsintervall"
    },
    "secs": {
        "en": "seconds",
        "de": "Sekunden"
    },
    "mA": {
        "en": "mA",
        "de": "mA"
    },
    "watts": {
        "en": "watts",
        "de": "W"
    },
    "only-special-values": {
        "en": "Following values are only needed if wallbox is to be regulated by photovoltaics unit",
        "de": "Folgende Werte werden nur benötigt, wenn die Wallbox abhängig von einer PV-Anlage geregelt werden soll"
    },
    "regard": {
        "en": "Name of regard state",
        "de": "Name des States für Netzbezug"
    },
    "surplus": {
        "en": "Name of surplus state",
        "de": "Name des States für Netzeinspeisung"
    },
    "delta":   {
        "en": "Step size",
        "de": "Schrittweite"
    },
    "underusage":   {
        "en": "Charging under-usage",
        "de": "Ladeunterschreitung"
    },
    "minTime":   {
        "en": "Minimum charging time",
        "de": "Mindestladezeit"
    },
    "powerLimitation": {
        "en": "Following values are only needed if maximum power must be limited",
        "de": "Folgende Werte werden nur benötigt, wenn die Gesamtleistung begrenzt ist"
    },
    "maxPower":   {
        "en": "Maximum power consumption surplus",
        "de": "Maximaler Netzbezug"
    },
    "energyMeter1":   {
        "en": "Name of state for 1st energy meter",
        "de": "Name des States für 1. Energy-Meter"
    },
    "energyMeter2":   {
        "en": "Name of state for 2nd energy meter",
        "de": "Name des States für 2. Energy-Meter"
    },
    "energyMeter3":   {
        "en": "Name of state for 3rd energy meter",
        "de": "Name des States für 3. Energy-Meter"
    },
    "wallboxNotIncluded":   {
        "en": "Power of wallbox NOT included in energy meter(s)",
        "de": "Verbrauch der Wallbox in keinem der Energy-Meter enthalten"
    },
    "tooltip_host": {
        "en": "IP address of KEBA KeContact wallbox", 
        "de": "IP-Adresse der KEBA KeContact-Wallbox",
        "ru": "IP Адрес KEBA KeContact"
    },
    "tooltip_passiveMode": {
        "en": "KEBA KeContact wallbox keeps passive (no power regulation)", 
        "de": "IKEBA KeContact-Wallbox bleibt passiv (keine Leistungsregelung)"
    },
    "tooltip_pollInterval": {
        "en": "Interval in seconds how often the wallbox should be queried for new values (minimum 5 seconds, 0 = no queries, just broadcasts)", 
        "de": "Intervall in Sekunden (mind. 5 Sek.) wie oft neue Werte in der Wallbox abgefragt werden sollen (0 = keine Abfrage, nur Broadcast lesen)"
    },
    "tooltip_stateRegard": {
        "en": "Name of state which holds regard value of energy meter. If both regard and surplus are contained in one state, fill in state here only if regard is a positive value and surplus is negative.", 
        "de": "Name des States für den Netzbezug des EnergyMeters. Werden Bezug und Einspeisung im selben State gespeichert und der Netzbezug ist positiv und die Einspeisung negativ, dann ist er hier nur anzugeben."
    },
    "tooltip_stateSurplus": {
        "en": "Name of state which holds surplus value of energy meter. If both regard and surplus are contained in one state, fill in state here only if surplus is a positive value and regard is negative.",
        "de": "Name des States für die Netzeinspeisung des EnergyMeters. Werden Bezug und Einspeisung im selben State gespeichert und die Einspeisung ist positiv und der Netzbezug negativ, dann ist er hier nur anzugeben."
    },
    "tooltip_delta": {
        "en": "Controlled process variable by which charging station is regulated",
        "de": "Regelung der Wallbox erfolgt in den angegebenen Schritten"
    },
    "tooltip_underusage": {
        "en": "If photovoltaics has less surplus than needed to minimally charge your EV, charging shall continue unless more than the specified watts are taken from extern",
        "de": "Unterschreitet der Überschuss der PV-Anlage die minimale Ladestärke, soll der Ladevorgang erst bei einem Netzbezug über der angegebenen Wattzahl unterbrochen werden"
    },
    "tooltip_minTime": {
        "en": "If photovoltaics has less surplus than needed to minimally charge your EV, charging shall continue unless the EV was charged for the specified amount of time",
        "de": "Unterschreitet der Überschuss der PV-Anlage die minimale Ladestärke, soll der Ladevorgang erst unterbrochen werden, wenn mindestens die angegebene Zeit geladen wurde"
    },
    "tooltip_maxPower": {
        "en": "You can define a maximum of watts which can must not be reached by all consumers",
        "de": "Mit diesem Wert kann die Leistung der Wallbox so begrenzt werden, dass ein max. Gesamtverbrauch nicht überschritten wird. Dies ist nötig, wenn der Netzbetreiber eine max. Leistung aufgrund begrenzter Kapazität vorgibt."
    },
    "tooltip_stateEnergyMeter1": {
        "en": "Name of state for the 1st energy meter which shall be used to calculate max. power consumption for power limitation",
        "de": "Name des States des 1. Energy-Meters, das für die Berechnung des Gesamtverbrauchs für die Leistungsbegrenzung einbezogen wird."
    },
    "tooltip_stateEnergyMeter2": {
        "en": "Name of state for the 2nd energy meter which shall be used to calculate max. power consumption for power limitation",
        "de": "Name des States des 2. Energy-Meters, das für die Berechnung des Gesamtverbrauchs für die Leistungsbegrenzung einbezogen wird."
    },
    "tooltip_stateEnergyMeter3": {
        "en": "Name of state for the 3rd energy meter which shall be used to calculate max. power consumption for power limitation",
        "de": "Name des States des 3. Energy-Meters, das für die Berechnung des Gesamtverbrauchs für die Leistungsbegrenzung einbezogen wird."
    },
    "tooltip_wallboxNotIncluded": {
        "en": "Check if none of the listed energy meters also cover power consumption of wallbox",
        "de": "Die Option ist zu markieren, wenn der Verbrauch der Wallbox nicht in der Leistung der Energy-Meter enthalten ist."
    },
};