/*
  Devices IoT Platform - Firmware ESP32
  Versão: v1.1.3

  Sensores:
  - Nível por ultrassônico
  - Temperatura e umidade por DHT11/DHT22
  - Relé 1
  - Relé 2
  - Relé 3
  - Reserva 1
  - Reserva 2

  Comandos:
  - Recebe comandos MQTT em:
    devices/{device_id}/cmd

  Exemplo de comando:
  {
    "device_id": "predio/torreA/sub1/reservatorio2",
    "relay": 1,
    "state": true
  }
*/

#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <PubSubClient.h>
#include <WiFiManager.h>
#include <Preferences.h>
#include <Ticker.h>
#include <DHT.h>

#define FW_VERSION "1.1.3"

// =========================
// PINOS
// =========================
#define PIN_FACTORY_RESET 0
#define PIN_LED 2

// Ultrassônico
#define PIN_TRIG 5
#define PIN_ECHO 18

// Temperatura e umidade
#define PIN_DHT 4
#define DHTTYPE DHT11
// Se usar DHT22, troque para:
// #define DHTTYPE DHT22

// Relés
#define PIN_RELAY1 25
#define PIN_RELAY2 26
#define PIN_RELAY3 27

// Módulo de relé ativo em LOW
#define RELAY_ON_LEVEL LOW
#define RELAY_OFF_LEVEL HIGH

// Reservas analógicas
#define PIN_RESERVA1 32
#define PIN_RESERVA2 33

// =========================
// CONFIGURAÇÕES PADRÃO
// =========================
Preferences prefs;

char deviceId[80] = "predio/torreA/sub1/reservatorio2";
char mqttHost[120] = "61a2835a1bf84052b9c2b861a7e33fc9.s1.eu.hivemq.cloud";
char mqttPortStr[8] = "8883";
char mqttUser[40] = "devices";
char mqttPass[80] = "";
char mqttTopic[150] = "devices/predio/torreA/sub1/reservatorio2/telemetry";
char intervalStr[10] = "15000";

char tankHeightStr[10] = "1700";

char enableUltrasonicStr[4] = "1";
char enableDhtStr[4] = "1";
char enableRelaysStr[4] = "1";
char enableReserva1Str[4] = "1";
char enableReserva2Str[4] = "1";

bool shouldSaveConfig = false;

WiFiClientSecure secureClient;
PubSubClient mqttClient(secureClient);

Ticker ledTicker;
DHT dht(PIN_DHT, DHTTYPE);

unsigned long lastSend = 0;

void sendTelemetry();

// =========================
// LED STATUS
// =========================
void ledBlinkTick() {
  digitalWrite(PIN_LED, !digitalRead(PIN_LED));
}

void startLedBlink() {
  ledTicker.detach();
  ledTicker.attach_ms(300, ledBlinkTick);
}

void ledConnected() {
  ledTicker.detach();
  digitalWrite(PIN_LED, HIGH);
}

void ledOff() {
  ledTicker.detach();
  digitalWrite(PIN_LED, LOW);
}

// =========================
// CÓPIA SEGURA
// =========================
void safeCopy(char *dest, const char *src, size_t size) {
  strncpy(dest, src, size - 1);
  dest[size - 1] = '\0';
}

// =========================
// TOPIC DE COMANDO
// =========================
String getCommandTopic() {
  String topic = String(mqttTopic);

  if (topic.endsWith("/telemetry")) {
    topic.remove(topic.length() - String("/telemetry").length());
    topic += "/cmd";
    return topic;
  }

  return "devices/" + String(deviceId) + "/cmd";
}

// =========================
// CALLBACK WIFI MANAGER
// =========================
void saveConfigCallback() {
  shouldSaveConfig = true;
}

// =========================
// RESET DE FÁBRICA
// =========================
void checkFactoryReset() {
  pinMode(PIN_FACTORY_RESET, INPUT_PULLUP);

  if (digitalRead(PIN_FACTORY_RESET) == LOW) {
    unsigned long start = millis();

    Serial.println("BOOT pressionado. Segure 5 segundos para resetar.");

    while (digitalRead(PIN_FACTORY_RESET) == LOW) {
      digitalWrite(PIN_LED, !digitalRead(PIN_LED));
      delay(250);

      if (millis() - start > 5000) {
        Serial.println("Reset de fabrica iniciado...");

        WiFiManager wm;
        wm.resetSettings();

        prefs.begin("devices", false);
        prefs.clear();
        prefs.end();

        delay(1000);
        ESP.restart();
      }
    }
  }
}

// =========================
// CARREGAR CONFIGURAÇÕES
// =========================
void loadConfig() {
  prefs.begin("devices", true);

  prefs.getString("deviceId", deviceId).toCharArray(deviceId, sizeof(deviceId));
  prefs.getString("mqttHost", mqttHost).toCharArray(mqttHost, sizeof(mqttHost));
  prefs.getString("mqttPort", mqttPortStr).toCharArray(mqttPortStr, sizeof(mqttPortStr));
  prefs.getString("mqttUser", mqttUser).toCharArray(mqttUser, sizeof(mqttUser));
  prefs.getString("mqttPass", mqttPass).toCharArray(mqttPass, sizeof(mqttPass));
  prefs.getString("mqttTopic", mqttTopic).toCharArray(mqttTopic, sizeof(mqttTopic));
  prefs.getString("interval", intervalStr).toCharArray(intervalStr, sizeof(intervalStr));

  prefs.getString("tankHeight", tankHeightStr).toCharArray(tankHeightStr, sizeof(tankHeightStr));

  prefs.getString("ultra", enableUltrasonicStr).toCharArray(enableUltrasonicStr, sizeof(enableUltrasonicStr));
  prefs.getString("dht", enableDhtStr).toCharArray(enableDhtStr, sizeof(enableDhtStr));
  prefs.getString("relays", enableRelaysStr).toCharArray(enableRelaysStr, sizeof(enableRelaysStr));
  prefs.getString("res1", enableReserva1Str).toCharArray(enableReserva1Str, sizeof(enableReserva1Str));
  prefs.getString("res2", enableReserva2Str).toCharArray(enableReserva2Str, sizeof(enableReserva2Str));

  prefs.end();
}

// =========================
// SALVAR CONFIGURAÇÕES
// =========================
void saveConfig() {
  prefs.begin("devices", false);

  prefs.putString("deviceId", deviceId);
  prefs.putString("mqttHost", mqttHost);
  prefs.putString("mqttPort", mqttPortStr);
  prefs.putString("mqttUser", mqttUser);
  prefs.putString("mqttPass", mqttPass);
  prefs.putString("mqttTopic", mqttTopic);
  prefs.putString("interval", intervalStr);

  prefs.putString("tankHeight", tankHeightStr);

  prefs.putString("ultra", enableUltrasonicStr);
  prefs.putString("dht", enableDhtStr);
  prefs.putString("relays", enableRelaysStr);
  prefs.putString("res1", enableReserva1Str);
  prefs.putString("res2", enableReserva2Str);

  prefs.end();

  Serial.println("Configuracoes salvas.");
}

// =========================
// WIFI MANAGER
// =========================
void setupWiFiManager() {
  WiFiManager wm;

  wm.setSaveConfigCallback(saveConfigCallback);
  wm.setConfigPortalTimeout(0);
  wm.setConnectTimeout(20);

  WiFiManagerParameter p_device("device", "Device ID", deviceId, 80);
  WiFiManagerParameter p_host("host", "Broker MQTT", mqttHost, 120);
  WiFiManagerParameter p_port("port", "Porta MQTT", mqttPortStr, 8);
  WiFiManagerParameter p_user("user", "Usuario MQTT", mqttUser, 40);
  WiFiManagerParameter p_pass("pass", "Senha MQTT", mqttPass, 80);
  WiFiManagerParameter p_topic("topic", "Topic MQTT", mqttTopic, 150);
  WiFiManagerParameter p_interval("interval", "Intervalo ms", intervalStr, 10);

  WiFiManagerParameter p_tankHeight("tankheight", "Altura reservatorio mm", tankHeightStr, 10);

  WiFiManagerParameter p_ultra("ultra", "Nivel ultrassonico 1/0", enableUltrasonicStr, 4);
  WiFiManagerParameter p_dht("dht", "Temp/Umidade 1/0", enableDhtStr, 4);
  WiFiManagerParameter p_relays("relays", "Reles 1/0", enableRelaysStr, 4);
  WiFiManagerParameter p_res1("res1", "Reserva 1 1/0", enableReserva1Str, 4);
  WiFiManagerParameter p_res2("res2", "Reserva 2 1/0", enableReserva2Str, 4);

  wm.addParameter(&p_device);
  wm.addParameter(&p_host);
  wm.addParameter(&p_port);
  wm.addParameter(&p_user);
  wm.addParameter(&p_pass);
  wm.addParameter(&p_topic);
  wm.addParameter(&p_interval);

  wm.addParameter(&p_tankHeight);

  wm.addParameter(&p_ultra);
  wm.addParameter(&p_dht);
  wm.addParameter(&p_relays);
  wm.addParameter(&p_res1);
  wm.addParameter(&p_res2);

  Serial.println("Iniciando WiFiManager...");
  Serial.println("Rede: Devices-Setup");
  Serial.println("Senha: 12345678");
  Serial.println("LED piscando = aguardando conexao.");

  startLedBlink();

  bool connected = wm.autoConnect("Devices-Setup", "12345678");

  if (!connected) {
    Serial.println("Falha ao conectar. Reiniciando...");
    delay(2000);
    ESP.restart();
  }

  safeCopy(deviceId, p_device.getValue(), sizeof(deviceId));
  safeCopy(mqttHost, p_host.getValue(), sizeof(mqttHost));
  safeCopy(mqttPortStr, p_port.getValue(), sizeof(mqttPortStr));
  safeCopy(mqttUser, p_user.getValue(), sizeof(mqttUser));
  safeCopy(mqttPass, p_pass.getValue(), sizeof(mqttPass));
  safeCopy(mqttTopic, p_topic.getValue(), sizeof(mqttTopic));
  safeCopy(intervalStr, p_interval.getValue(), sizeof(intervalStr));

  safeCopy(tankHeightStr, p_tankHeight.getValue(), sizeof(tankHeightStr));

  safeCopy(enableUltrasonicStr, p_ultra.getValue(), sizeof(enableUltrasonicStr));
  safeCopy(enableDhtStr, p_dht.getValue(), sizeof(enableDhtStr));
  safeCopy(enableRelaysStr, p_relays.getValue(), sizeof(enableRelaysStr));
  safeCopy(enableReserva1Str, p_res1.getValue(), sizeof(enableReserva1Str));
  safeCopy(enableReserva2Str, p_res2.getValue(), sizeof(enableReserva2Str));

  saveConfig();

  Serial.println("Wi-Fi conectado com sucesso.");
  Serial.print("IP local: ");
  Serial.println(WiFi.localIP());
}

// =========================
// RELÉS
// =========================
void setRelayState(int relay, bool state) {
  int pin = -1;

  if (relay == 1) pin = PIN_RELAY1;
  if (relay == 2) pin = PIN_RELAY2;
  if (relay == 3) pin = PIN_RELAY3;

  if (pin == -1) {
    Serial.println("Relé inválido.");
    return;
  }

  int outputLevel = state ? RELAY_ON_LEVEL : RELAY_OFF_LEVEL;

  digitalWrite(pin, outputLevel);
  delay(100);

  Serial.print("Relé ");
  Serial.print(relay);
  Serial.print(" comando: ");
  Serial.println(state ? "LIGAR" : "DESLIGAR");

  Serial.print("GPIO usado: ");
  Serial.println(pin);

  Serial.print("Nivel enviado ao GPIO: ");
  Serial.println(outputLevel == HIGH ? "HIGH" : "LOW");

  Serial.print("Nivel lido no GPIO apos comando: ");
  Serial.println(digitalRead(pin) == HIGH ? "HIGH" : "LOW");
}

bool getRelayLogicalState(int pin) {
  return digitalRead(pin) == RELAY_ON_LEVEL;
}

// =========================
// PARSER SIMPLES JSON COMANDO
// =========================
bool extractRelayNumber(String msg, int &relay) {
  int idx = msg.indexOf("\"relay\"");
  if (idx < 0) idx = msg.indexOf("relay");
  if (idx < 0) return false;

  int colon = msg.indexOf(':', idx);
  if (colon < 0) return false;

  int start = colon + 1;

  while (start < msg.length() && !isDigit(msg[start]) && msg[start] != '-') {
    start++;
  }

  int end = start;

  while (end < msg.length() && (isDigit(msg[end]) || msg[end] == '-')) {
    end++;
  }

  if (start >= msg.length() || end <= start) return false;

  relay = msg.substring(start, end).toInt();
  return true;
}

bool extractStateValue(String msg, bool &state) {
  int idx = msg.indexOf("\"state\"");
  if (idx < 0) idx = msg.indexOf("state");
  if (idx < 0) return false;

  int colon = msg.indexOf(':', idx);
  if (colon < 0) return false;

  String value = msg.substring(colon + 1);
  value.trim();
  value.toLowerCase();

  if (
    value.startsWith("true") ||
    value.startsWith("1") ||
    value.startsWith("\"true\"") ||
    value.startsWith("\"1\"") ||
    value.startsWith("\"on\"") ||
    value.startsWith("\"ligar\"") ||
    value.startsWith("\"liga\"")
  ) {
    state = true;
    return true;
  }

  if (
    value.startsWith("false") ||
    value.startsWith("0") ||
    value.startsWith("\"false\"") ||
    value.startsWith("\"0\"") ||
    value.startsWith("\"off\"") ||
    value.startsWith("\"desligar\"") ||
    value.startsWith("\"desliga\"")
  ) {
    state = false;
    return true;
  }

  return false;
}

// =========================
// SENSOR ULTRASSÔNICO
// =========================
float readDistanceMM() {
  digitalWrite(PIN_TRIG, LOW);
  delayMicroseconds(2);

  digitalWrite(PIN_TRIG, HIGH);
  delayMicroseconds(10);
  digitalWrite(PIN_TRIG, LOW);

  long duration = pulseIn(PIN_ECHO, HIGH, 30000);

  if (duration == 0) {
    return -1;
  }

  float distanceCm = duration * 0.0343 / 2.0;
  return distanceCm * 10.0;
}

float calculateLevelPercent(float distanceMM) {
  float alturaReservatorioMM = atof(tankHeightStr);

  if (alturaReservatorioMM <= 0) {
    alturaReservatorioMM = 1700.0;
  }

  if (distanceMM < 0) {
    return -1;
  }

  float nivel = 100.0 - ((distanceMM / alturaReservatorioMM) * 100.0);

  if (nivel < 0) nivel = 0;
  if (nivel > 100) nivel = 100;

  return nivel;
}

float calculateLevelMM(float distanceMM) {
  float alturaReservatorioMM = atof(tankHeightStr);

  if (alturaReservatorioMM <= 0) {
    alturaReservatorioMM = 1700.0;
  }

  if (distanceMM < 0) {
    return -1;
  }

  float nivelMM = alturaReservatorioMM - distanceMM;

  if (nivelMM < 0) nivelMM = 0;
  if (nivelMM > alturaReservatorioMM) nivelMM = alturaReservatorioMM;

  return nivelMM;
}

// =========================
// TEMPERATURA E UMIDADE
// =========================
float readTemperatureC() {
  float temp = dht.readTemperature();

  if (isnan(temp)) {
    return -1;
  }

  return temp;
}

float readHumidity() {
  float hum = dht.readHumidity();

  if (isnan(hum)) {
    return -1;
  }

  return hum;
}

// =========================
// RESERVAS
// =========================
int readReserva1() {
  return analogRead(PIN_RESERVA1);
}

int readReserva2() {
  return analogRead(PIN_RESERVA2);
}

// =========================
// ENVIO MQTT TELEMETRIA
// =========================
void sendTelemetry() {
  bool enableUltra = String(enableUltrasonicStr) == "1";
  bool enableDht = String(enableDhtStr) == "1";
  bool enableRelays = String(enableRelaysStr) == "1";
  bool enableReserva1 = String(enableReserva1Str) == "1";
  bool enableReserva2 = String(enableReserva2Str) == "1";

  float distanciaMM = enableUltra ? readDistanceMM() : -1;
  float nivelPct = enableUltra ? calculateLevelPercent(distanciaMM) : -1;
  float nivelMM = enableUltra ? calculateLevelMM(distanciaMM) : -1;

  float tempC = enableDht ? readTemperatureC() : -1;
  float umidPct = enableDht ? readHumidity() : -1;

  bool relay1 = enableRelays ? getRelayLogicalState(PIN_RELAY1) : false;
  bool relay2 = enableRelays ? getRelayLogicalState(PIN_RELAY2) : false;
  bool relay3 = enableRelays ? getRelayLogicalState(PIN_RELAY3) : false;

  int reserva1 = enableReserva1 ? readReserva1() : -1;
  int reserva2 = enableReserva2 ? readReserva2() : -1;

  String payload = "{";
  payload += "\"device_id\":\"" + String(deviceId) + "\",";
  payload += "\"fw_version\":\"" + String(FW_VERSION) + "\",";
  payload += "\"nivel_pct\":" + String(nivelPct, 1) + ",";
  payload += "\"nivel_mm\":" + String(nivelMM, 1) + ",";
  payload += "\"distancia_mm\":" + String(distanciaMM, 1) + ",";
  payload += "\"temp_c\":" + String(tempC, 1) + ",";
  payload += "\"umid_pct\":" + String(umidPct, 1) + ",";
  payload += "\"wifi_rssi\":" + String(WiFi.RSSI()) + ",";
  payload += "\"relay1\":" + String(relay1 ? "true" : "false") + ",";
  payload += "\"relay2\":" + String(relay2 ? "true" : "false") + ",";
  payload += "\"relay3\":" + String(relay3 ? "true" : "false") + ",";
  payload += "\"reserva1\":" + String(reserva1) + ",";
  payload += "\"reserva2\":" + String(reserva2);
  payload += "}";

  bool sent = mqttClient.publish(mqttTopic, payload.c_str());

  if (sent) {
    Serial.println("Telemetria enviada:");
    Serial.println(payload);
  } else {
    Serial.println("Falha ao publicar telemetria MQTT.");
  }
}

// =========================
// PROCESSAR COMANDO MQTT
// =========================
void processCommand(String topic, String msg) {
  String expectedTopic = getCommandTopic();

  if (topic != expectedTopic) {
    Serial.print("Comando ignorado. Topic recebido: ");
    Serial.println(topic);
    return;
  }

  Serial.println("Comando recebido:");
  Serial.println(msg);

  int relay = 0;
  bool state = false;

  if (!extractRelayNumber(msg, relay)) {
    Serial.println("Comando inválido: relay ausente.");
    return;
  }

  if (!extractStateValue(msg, state)) {
    Serial.println("Comando inválido: state ausente.");
    return;
  }

  if (relay < 1 || relay > 3) {
    Serial.println("Comando inválido: relay deve ser 1, 2 ou 3.");
    return;
  }

  setRelayState(relay, state);

  delay(200);

  sendTelemetry();
}

// =========================
// CALLBACK MQTT
// =========================
void mqttCallback(char* topic, byte* payload, unsigned int length) {
  String msg = "";

  for (unsigned int i = 0; i < length; i++) {
    msg += (char)payload[i];
  }

  processCommand(String(topic), msg);
}

// =========================
// MQTT
// =========================
void reconnectMQTT() {
  while (!mqttClient.connected()) {
    startLedBlink();

    uint64_t chipId = ESP.getEfuseMac();
    String clientId = "devices-esp32-" + String((uint32_t)(chipId >> 32), HEX) + String((uint32_t)chipId, HEX);

    Serial.print("Conectando MQTT em: ");
    Serial.println(mqttHost);

    bool connected = mqttClient.connect(clientId.c_str(), mqttUser, mqttPass);

    if (connected) {
      Serial.println("MQTT conectado.");

      String cmdTopic = getCommandTopic();

      if (mqttClient.subscribe(cmdTopic.c_str())) {
        Serial.print("Assinando comandos em: ");
        Serial.println(cmdTopic);
      } else {
        Serial.println("Falha ao assinar topic de comando.");
      }

      ledConnected();
    } else {
      Serial.print("Falha MQTT. Estado: ");
      Serial.println(mqttClient.state());
      Serial.println("Tentando novamente em 5 segundos...");
      delay(5000);
    }
  }
}

// =========================
// SETUP
// =========================
void setup() {
  Serial.begin(115200);
  delay(500);

  pinMode(PIN_LED, OUTPUT);
  digitalWrite(PIN_LED, LOW);

  pinMode(PIN_TRIG, OUTPUT);
  pinMode(PIN_ECHO, INPUT);

  pinMode(PIN_RESERVA1, INPUT);
  pinMode(PIN_RESERVA2, INPUT);

  pinMode(PIN_RELAY1, OUTPUT);
  pinMode(PIN_RELAY2, OUTPUT);
  pinMode(PIN_RELAY3, OUTPUT);

  digitalWrite(PIN_RELAY1, RELAY_OFF_LEVEL);
  digitalWrite(PIN_RELAY2, RELAY_OFF_LEVEL);
  digitalWrite(PIN_RELAY3, RELAY_OFF_LEVEL);

  dht.begin();

  Serial.println();
  Serial.println("==================================");
  Serial.println("Devices IoT ESP32 iniciando...");
  Serial.print("Firmware: ");
  Serial.println(FW_VERSION);
  Serial.println("==================================");

  checkFactoryReset();

  loadConfig();

  setupWiFiManager();

  secureClient.setInsecure();

  int mqttPort = atoi(mqttPortStr);

  mqttClient.setServer(mqttHost, mqttPort);
  mqttClient.setCallback(mqttCallback);
  mqttClient.setBufferSize(1024);
  mqttClient.setKeepAlive(30);

  reconnectMQTT();

  Serial.println("Sistema iniciado com sucesso.");
  Serial.print("Device ID: ");
  Serial.println(deviceId);
  Serial.print("Telemetry Topic: ");
  Serial.println(mqttTopic);
  Serial.print("Command Topic: ");
  Serial.println(getCommandTopic());
}

// =========================
// LOOP
// =========================
void loop() {
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("Wi-Fi desconectado. Reiniciando para abrir portal...");
    startLedBlink();
    delay(2000);
    ESP.restart();
  }

  if (!mqttClient.connected()) {
    reconnectMQTT();
  }

  mqttClient.loop();

  unsigned long interval = atol(intervalStr);

  if (interval < 5000) {
    interval = 5000;
  }

  if (millis() - lastSend >= interval) {
    lastSend = millis();
    sendTelemetry();
  }
}