-- Comparación de retenciones: archivo de Catalina ("Aplicacion de impuestos - Clientes", hoja "Respuestas de formulario 1")
-- contra lo que usa el radicador (mapping_rules). Generado el 24-nov-2026 con 90 clientes del archivo.
-- Supuestos de columnas del archivo de Catalina (confirmar con Catalina/Jenny):
--   E "Es agente de retención en la fuente"                 -> Retefuente
--   F "Es agente de retención en la fuente sobre las ventas" -> Reteiva
--   G "Es agente de retención de ica en Bogotá"              -> Reteica
-- NIT: sin dígito de verificación (lo que va después del guion; si viene pegado con 10 dígitos se quita el último).
WITH catalina AS (
  SELECT * FROM UNNEST([
  STRUCT('800071617' AS nit, 'CUMMINS DE LOS ANDES S.A' AS razon_catalina, TRUE AS rf_cat, FALSE AS ri_cat, TRUE AS riva_cat, TRUE AS verificado),
  STRUCT('900044844' AS nit, 'PROLUB COMBUSTIBLES Y LUBRICANTES S.A.' AS razon_catalina, TRUE AS rf_cat, FALSE AS ri_cat, FALSE AS riva_cat, TRUE AS verificado),
  STRUCT('830080877' AS nit, 'LA DOLCEZZA SAS' AS razon_catalina, TRUE AS rf_cat, TRUE AS ri_cat, FALSE AS riva_cat, TRUE AS verificado),
  STRUCT('800219290' AS nit, 'SERVIBARRAS SAS' AS razon_catalina, TRUE AS rf_cat, FALSE AS ri_cat, TRUE AS riva_cat, TRUE AS verificado),
  STRUCT('901816986' AS nit, 'WE DUES SAS' AS razon_catalina, TRUE AS rf_cat, FALSE AS ri_cat, FALSE AS riva_cat, TRUE AS verificado),
  STRUCT('900677224' AS nit, 'SOLE SOLUCIONES EFICIENTES SAS' AS razon_catalina, TRUE AS rf_cat, TRUE AS ri_cat, FALSE AS riva_cat, TRUE AS verificado),
  STRUCT('860513493' AS nit, 'CONSTRUCTORA BOLIVAR S.A. - BOGOTA' AS razon_catalina, TRUE AS rf_cat, TRUE AS ri_cat, TRUE AS riva_cat, TRUE AS verificado),
  STRUCT('900363141' AS nit, 'Snacks de Colombia sas' AS razon_catalina, TRUE AS rf_cat, FALSE AS ri_cat, FALSE AS riva_cat, TRUE AS verificado),
  STRUCT('901286481' AS nit, 'GRUPO HELPPO SAS' AS razon_catalina, TRUE AS rf_cat, FALSE AS ri_cat, FALSE AS riva_cat, TRUE AS verificado),
  STRUCT('860533081' AS nit, 'ARTE LITOGRAFICO S A S' AS razon_catalina, TRUE AS rf_cat, TRUE AS ri_cat, FALSE AS riva_cat, TRUE AS verificado),
  STRUCT('900328425' AS nit, 'ATLTANTIK BIO ZONA FRANCA SAS' AS razon_catalina, TRUE AS rf_cat, FALSE AS ri_cat, TRUE AS riva_cat, TRUE AS verificado),
  STRUCT('901085784' AS nit, 'INNOVATION SHOP SAS' AS razon_catalina, TRUE AS rf_cat, TRUE AS ri_cat, FALSE AS riva_cat, TRUE AS verificado),
  STRUCT('805014762' AS nit, 'MERCANTIL CONTINENTAL SAS' AS razon_catalina, TRUE AS rf_cat, FALSE AS ri_cat, FALSE AS riva_cat, TRUE AS verificado),
  STRUCT('860530370' AS nit, 'LIDER PRODUCTOS PUBLICITARIOS SAS' AS razon_catalina, TRUE AS rf_cat, TRUE AS ri_cat, TRUE AS riva_cat, TRUE AS verificado),
  STRUCT('900530142' AS nit, 'ECOFLUIDOS SAS' AS razon_catalina, FALSE AS rf_cat, FALSE AS ri_cat, FALSE AS riva_cat, TRUE AS verificado),
  STRUCT('901701650' AS nit, 'ALIMENTOS Y COSAS SAS' AS razon_catalina, TRUE AS rf_cat, FALSE AS ri_cat, FALSE AS riva_cat, TRUE AS verificado),
  STRUCT('860037900' AS nit, 'CONSTRUCTORA BOLIVAR CALI SA' AS razon_catalina, TRUE AS rf_cat, FALSE AS ri_cat, TRUE AS riva_cat, TRUE AS verificado),
  STRUCT('901756941' AS nit, 'PURAS DURAS SAS' AS razon_catalina, TRUE AS rf_cat, TRUE AS ri_cat, FALSE AS riva_cat, TRUE AS verificado),
  STRUCT('811026536' AS nit, 'SUSI SAS' AS razon_catalina, TRUE AS rf_cat, TRUE AS ri_cat, TRUE AS riva_cat, TRUE AS verificado),
  STRUCT('900365051' AS nit, 'POWER GROUP' AS razon_catalina, TRUE AS rf_cat, FALSE AS ri_cat, TRUE AS riva_cat, TRUE AS verificado),
  STRUCT('800195301' AS nit, 'FABRICACIÓN DE GERMICIDAS COLOMBIA LTDA' AS razon_catalina, TRUE AS rf_cat, TRUE AS ri_cat, FALSE AS riva_cat, TRUE AS verificado),
  STRUCT('900590424' AS nit, 'NETDATA COLOMBIA SAS' AS razon_catalina, TRUE AS rf_cat, TRUE AS ri_cat, FALSE AS riva_cat, TRUE AS verificado),
  STRUCT('901931288' AS nit, 'PRINTU PACK SAS' AS razon_catalina, TRUE AS rf_cat, TRUE AS ri_cat, FALSE AS riva_cat, TRUE AS verificado),
  STRUCT('901627545' AS nit, 'Comercializadora y distribuidora Maqser' AS razon_catalina, TRUE AS rf_cat, FALSE AS ri_cat, TRUE AS riva_cat, TRUE AS verificado),
  STRUCT('901556234' AS nit, 'PEAKR COLOMBIA SAS' AS razon_catalina, TRUE AS rf_cat, FALSE AS ri_cat, FALSE AS riva_cat, TRUE AS verificado),
  STRUCT('830028873' AS nit, 'ISITEC SAS' AS razon_catalina, TRUE AS rf_cat, TRUE AS ri_cat, TRUE AS riva_cat, TRUE AS verificado),
  STRUCT('900275661' AS nit, 'INTEGRA  PRODUCCION Y LOGISTICA SAS' AS razon_catalina, TRUE AS rf_cat, TRUE AS ri_cat, TRUE AS riva_cat, TRUE AS verificado),
  STRUCT('830067329' AS nit, 'PAR SERVICIOS INTEGRALES SA' AS razon_catalina, TRUE AS rf_cat, TRUE AS ri_cat, TRUE AS riva_cat, TRUE AS verificado),
  STRUCT('900064762' AS nit, 'GNH COLOMBIA SAS' AS razon_catalina, TRUE AS rf_cat, TRUE AS ri_cat, TRUE AS riva_cat, TRUE AS verificado),
  STRUCT('900397497' AS nit, 'SYGMA Laboratories SAS' AS razon_catalina, TRUE AS rf_cat, TRUE AS ri_cat, TRUE AS riva_cat, TRUE AS verificado),
  STRUCT('830067529' AS nit, 'DISEÑO MDC SAS' AS razon_catalina, TRUE AS rf_cat, TRUE AS ri_cat, FALSE AS riva_cat, TRUE AS verificado),
  STRUCT('830060677' AS nit, 'EXPOSE SOCIEDAD POR ACCIONES SIMPLIFICADA' AS razon_catalina, TRUE AS rf_cat, TRUE AS ri_cat, FALSE AS riva_cat, TRUE AS verificado),
  STRUCT('901080909' AS nit, 'COMERCIALIZADORA LA VIOLETA SAS' AS razon_catalina, TRUE AS rf_cat, TRUE AS ri_cat, FALSE AS riva_cat, TRUE AS verificado),
  STRUCT('901381198' AS nit, 'Digital Platforms Colombia SAS' AS razon_catalina, TRUE AS rf_cat, TRUE AS ri_cat, TRUE AS riva_cat, TRUE AS verificado),
  STRUCT('901181839' AS nit, 'GLOBAL STORE MARKET AND SUPPLIES SAS' AS razon_catalina, TRUE AS rf_cat, TRUE AS ri_cat, FALSE AS riva_cat, TRUE AS verificado),
  STRUCT('901195367' AS nit, 'colombiana de calderas colcalderas internacional sas' AS razon_catalina, TRUE AS rf_cat, FALSE AS ri_cat, FALSE AS riva_cat, TRUE AS verificado),
  STRUCT('900500679' AS nit, 'ENTREMES MAQUINAS DISPENSADORAS SAS' AS razon_catalina, TRUE AS rf_cat, TRUE AS ri_cat, TRUE AS riva_cat, TRUE AS verificado),
  STRUCT('900530539' AS nit, 'JGR INGENIERIA Y MANTNIMIENTO SAS' AS razon_catalina, TRUE AS rf_cat, TRUE AS ri_cat, FALSE AS riva_cat, TRUE AS verificado),
  STRUCT('900443187' AS nit, 'Dimensiones Unicas sas' AS razon_catalina, TRUE AS rf_cat, TRUE AS ri_cat, TRUE AS riva_cat, TRUE AS verificado),
  STRUCT('900581492' AS nit, 'TRABAJOS EN ELECTRICIDAD, REFRIGERACION, INGENIERIA Y COMUNICACIONES S.A.S' AS razon_catalina, TRUE AS rf_cat, FALSE AS ri_cat, FALSE AS riva_cat, TRUE AS verificado),
  STRUCT('830513736' AS nit, 'CARGAS DE COLOMBIA SAS' AS razon_catalina, TRUE AS rf_cat, TRUE AS ri_cat, TRUE AS riva_cat, FALSE AS verificado),
  STRUCT('900087414' AS nit, 'Riopaila  castillsa sa' AS razon_catalina, TRUE AS rf_cat, FALSE AS ri_cat, TRUE AS riva_cat, TRUE AS verificado),
  STRUCT('901132271' AS nit, 'Grupo aral S.A.S.' AS razon_catalina, TRUE AS rf_cat, FALSE AS ri_cat, FALSE AS riva_cat, TRUE AS verificado),
  STRUCT('900759950' AS nit, 'RESERCO INTERNATIONAL SERVICES IT SAS' AS razon_catalina, TRUE AS rf_cat, TRUE AS ri_cat, TRUE AS riva_cat, TRUE AS verificado),
  STRUCT('820003521' AS nit, 'Requerimientos Tecnicos SAS' AS razon_catalina, TRUE AS rf_cat, TRUE AS ri_cat, FALSE AS riva_cat, TRUE AS verificado),
  STRUCT('900957504' AS nit, 'SELCO INGENIERIA SAS' AS razon_catalina, TRUE AS rf_cat, FALSE AS ri_cat, FALSE AS riva_cat, TRUE AS verificado),
  STRUCT('901182784' AS nit, 'SADI CONTROL SAS' AS razon_catalina, TRUE AS rf_cat, FALSE AS ri_cat, FALSE AS riva_cat, TRUE AS verificado),
  STRUCT('900691351' AS nit, 'MAQUINARIA PEDROZA E HIJO SAS' AS razon_catalina, TRUE AS rf_cat, FALSE AS ri_cat, TRUE AS riva_cat, TRUE AS verificado),
  STRUCT('901002115' AS nit, 'Panaderia Barichara SAS' AS razon_catalina, TRUE AS rf_cat, FALSE AS ri_cat, TRUE AS riva_cat, TRUE AS verificado),
  STRUCT('830135377' AS nit, 'MERCADEO EFECTIVO SAS' AS razon_catalina, TRUE AS rf_cat, FALSE AS ri_cat, FALSE AS riva_cat, TRUE AS verificado),
  STRUCT('901958645' AS nit, 'COMERCIALIZADORA SNACKS PLR SAS' AS razon_catalina, TRUE AS rf_cat, TRUE AS ri_cat, FALSE AS riva_cat, TRUE AS verificado),
  STRUCT('901688984' AS nit, 'PREVENTICA SAS' AS razon_catalina, TRUE AS rf_cat, FALSE AS ri_cat, FALSE AS riva_cat, FALSE AS verificado),
  STRUCT('901612866' AS nit, 'GLOBAL ELECTRIK LATAM SAS' AS razon_catalina, TRUE AS rf_cat, FALSE AS ri_cat, FALSE AS riva_cat, TRUE AS verificado),
  STRUCT('900276879' AS nit, 'COMERCIALIZADORA LA GRAN SURTIDORA SAS' AS razon_catalina, TRUE AS rf_cat, TRUE AS ri_cat, TRUE AS riva_cat, FALSE AS verificado),
  STRUCT('830135377' AS nit, 'Mercadeo Efectivo S.A.S.' AS razon_catalina, TRUE AS rf_cat, TRUE AS ri_cat, TRUE AS riva_cat, FALSE AS verificado),
  STRUCT('830134971' AS nit, 'Conectar tv sas' AS razon_catalina, TRUE AS rf_cat, TRUE AS ri_cat, TRUE AS riva_cat, TRUE AS verificado),
  STRUCT('901862055' AS nit, 'PROCESADORA AGRICOLA DEL SUR SAS' AS razon_catalina, TRUE AS rf_cat, TRUE AS ri_cat, FALSE AS riva_cat, TRUE AS verificado),
  STRUCT('800240262' AS nit, 'INDUSTRIAS METALICAS SS SAS' AS razon_catalina, TRUE AS rf_cat, FALSE AS ri_cat, FALSE AS riva_cat, TRUE AS verificado),
  STRUCT('902017209' AS nit, 'BOILER SERVICES RL SAS' AS razon_catalina, FALSE AS rf_cat, FALSE AS ri_cat, TRUE AS riva_cat, TRUE AS verificado),
  STRUCT('900944793' AS nit, 'MAQUITEC DE COLOMBIA SAS' AS razon_catalina, TRUE AS rf_cat, TRUE AS ri_cat, FALSE AS riva_cat, TRUE AS verificado),
  STRUCT('901788151' AS nit, 'Ama cargo Group sas' AS razon_catalina, TRUE AS rf_cat, TRUE AS ri_cat, FALSE AS riva_cat, TRUE AS verificado),
  STRUCT('900856935' AS nit, 'NARZUMED SAS' AS razon_catalina, TRUE AS rf_cat, FALSE AS ri_cat, TRUE AS riva_cat, TRUE AS verificado),
  STRUCT('900619446' AS nit, 'SI SEÑOR SAS' AS razon_catalina, TRUE AS rf_cat, TRUE AS ri_cat, FALSE AS riva_cat, TRUE AS verificado),
  STRUCT('900255214' AS nit, 'COLSUGAR SAS' AS razon_catalina, TRUE AS rf_cat, FALSE AS ri_cat, FALSE AS riva_cat, TRUE AS verificado),
  STRUCT('901399676' AS nit, 'Inversiones Agropecuarias LOM' AS razon_catalina, TRUE AS rf_cat, TRUE AS ri_cat, TRUE AS riva_cat, FALSE AS verificado),
  STRUCT('830067638' AS nit, 'MARKA DISEÑO Y PRODUCCION SAS' AS razon_catalina, TRUE AS rf_cat, FALSE AS ri_cat, FALSE AS riva_cat, TRUE AS verificado),
  STRUCT('900702496' AS nit, 'GRUPO FMC SAS' AS razon_catalina, TRUE AS rf_cat, FALSE AS ri_cat, FALSE AS riva_cat, TRUE AS verificado),
  STRUCT('901077258' AS nit, 'TECH INDUSTRIES SAS' AS razon_catalina, TRUE AS rf_cat, TRUE AS ri_cat, FALSE AS riva_cat, FALSE AS verificado),
  STRUCT('901739721' AS nit, 'OPERATION MAINTENANCE AND SERVICES SAS' AS razon_catalina, TRUE AS rf_cat, FALSE AS ri_cat, FALSE AS riva_cat, TRUE AS verificado),
  STRUCT('901389657' AS nit, 'Comercializadora HPPL SAS' AS razon_catalina, TRUE AS rf_cat, TRUE AS ri_cat, FALSE AS riva_cat, TRUE AS verificado),
  STRUCT('900159278' AS nit, 'PROCTEK SAS' AS razon_catalina, TRUE AS rf_cat, TRUE AS ri_cat, TRUE AS riva_cat, TRUE AS verificado),
  STRUCT('901974316' AS nit, 'SCRUB DADDY COLOMBIA SAS' AS razon_catalina, TRUE AS rf_cat, FALSE AS ri_cat, TRUE AS riva_cat, TRUE AS verificado),
  STRUCT('830001584' AS nit, 'CONCRESERVICIOS SAS' AS razon_catalina, TRUE AS rf_cat, TRUE AS ri_cat, TRUE AS riva_cat, TRUE AS verificado),
  STRUCT('900407151' AS nit, 'Ci empaquetadora del norte sas' AS razon_catalina, TRUE AS rf_cat, FALSE AS ri_cat, FALSE AS riva_cat, TRUE AS verificado),
  STRUCT('900520051' AS nit, 'SERKAT SAS' AS razon_catalina, TRUE AS rf_cat, FALSE AS ri_cat, FALSE AS riva_cat, TRUE AS verificado),
  STRUCT('900561791' AS nit, 'ENEXPIA SAS' AS razon_catalina, TRUE AS rf_cat, TRUE AS ri_cat, FALSE AS riva_cat, TRUE AS verificado),
  STRUCT('900869616' AS nit, 'INGENIERIA DE PEREIRA SAS' AS razon_catalina, TRUE AS rf_cat, FALSE AS ri_cat, FALSE AS riva_cat, TRUE AS verificado),
  STRUCT('860001899' AS nit, 'CORPACERO SAS' AS razon_catalina, TRUE AS rf_cat, FALSE AS ri_cat, TRUE AS riva_cat, TRUE AS verificado),
  STRUCT('901142842' AS nit, 'CORPACERO ZONA FRANCA S.A.S. SIGLA CORPACERO Z.F. S.A.S.' AS razon_catalina, TRUE AS rf_cat, FALSE AS ri_cat, FALSE AS riva_cat, TRUE AS verificado),
  STRUCT('901259856' AS nit, 'GRUPO EMPRESARIAL PEMC S.A.S' AS razon_catalina, TRUE AS rf_cat, FALSE AS ri_cat, FALSE AS riva_cat, TRUE AS verificado),
  STRUCT('900868612' AS nit, 'PUNTONET INSUPERABLE S.A.S' AS razon_catalina, TRUE AS rf_cat, FALSE AS ri_cat, FALSE AS riva_cat, TRUE AS verificado),
  STRUCT('900297153' AS nit, 'COASPHARMA SAS' AS razon_catalina, TRUE AS rf_cat, TRUE AS ri_cat, TRUE AS riva_cat, TRUE AS verificado),
  STRUCT('901407164' AS nit, 'IN GRILL S.A.S.' AS razon_catalina, TRUE AS rf_cat, FALSE AS ri_cat, FALSE AS riva_cat, TRUE AS verificado),
  STRUCT('901314381' AS nit, 'SOLUCIONES E INNOVACION EN ALIMENTOS COLOMBIA S A S' AS razon_catalina, TRUE AS rf_cat, FALSE AS ri_cat, FALSE AS riva_cat, TRUE AS verificado),
  STRUCT('830105652' AS nit, 'GPSTRATEGY S.A.S' AS razon_catalina, TRUE AS rf_cat, TRUE AS ri_cat, FALSE AS riva_cat, TRUE AS verificado),
  STRUCT('900205377' AS nit, 'COMERCIALIZADORA AGROHIERROS S A' AS razon_catalina, TRUE AS rf_cat, TRUE AS ri_cat, TRUE AS riva_cat, TRUE AS verificado),
  STRUCT('900086174' AS nit, 'INMADICA ANDINA S A' AS razon_catalina, TRUE AS rf_cat, TRUE AS ri_cat, TRUE AS riva_cat, TRUE AS verificado),
  STRUCT('901617654' AS nit, 'SOCIEDAD CON PROPÓSITO SAS' AS razon_catalina, TRUE AS rf_cat, TRUE AS ri_cat, FALSE AS riva_cat, TRUE AS verificado),
  STRUCT('830058658' AS nit, 'MAC POWER SAS' AS razon_catalina, TRUE AS rf_cat, TRUE AS ri_cat, FALSE AS riva_cat, TRUE AS verificado),
  STRUCT('901113231' AS nit, 'SOLUCIONES TRANSPORTE Y LOGISTICA IBAZAN SAS' AS razon_catalina, TRUE AS rf_cat, FALSE AS ri_cat, FALSE AS riva_cat, TRUE AS verificado)
  ])
),
radicador AS (
  SELECT REGEXP_REPLACE(CAST(nit_cliente AS STRING), r'\D', '') AS nit, ANY_VALUE(razon_social) AS razon_mapping,
    ANY_VALUE(LOWER(TRIM(CAST(aplica_rete_fuente AS STRING)))) AS rf, ANY_VALUE(LOWER(TRIM(CAST(aplica_rete_ica AS STRING)))) AS ri,
    ANY_VALUE(LOWER(TRIM(CAST(aplica_rete_iva AS STRING)))) AS riva
  FROM `inlaid-stack-375114.analytics_data_products.mapping_rules`
  GROUP BY 1
),
norm AS (
  SELECT nit, razon_mapping,
    CASE WHEN rf IN ('si','sí','s','true','1','aplica','yes','x') THEN TRUE WHEN rf IN ('no','n','false','0','no aplica') THEN FALSE END AS rf_bd,
    CASE WHEN ri IN ('si','sí','s','true','1','aplica','yes','x') THEN TRUE WHEN ri IN ('no','n','false','0','no aplica') THEN FALSE END AS ri_bd,
    CASE WHEN riva IN ('si','sí','s','true','1','aplica','yes','x') THEN TRUE WHEN riva IN ('no','n','false','0','no aplica') THEN FALSE END AS riva_bd
  FROM radicador
)
SELECT * FROM (
SELECT c.nit, c.razon_catalina, c.verificado,
  CASE WHEN n.nit IS NULL THEN 'NO ESTÁ EN mapping_rules'
       WHEN n.rf_bd IS NULL AND n.ri_bd IS NULL AND n.riva_bd IS NULL THEN 'mapping_rules SIN DATO'
       WHEN n.rf_bd IS DISTINCT FROM c.rf_cat OR n.ri_bd IS DISTINCT FROM c.ri_cat OR n.riva_bd IS DISTINCT FROM c.riva_cat THEN 'DIFERENTE'
       ELSE 'IGUAL' END AS resultado,
  c.rf_cat, n.rf_bd, c.ri_cat, n.ri_bd, c.riva_cat, n.riva_bd
FROM catalina c LEFT JOIN norm n USING (nit)
)
ORDER BY CASE resultado WHEN 'DIFERENTE' THEN 1 WHEN 'mapping_rules SIN DATO' THEN 2 WHEN 'NO ESTÁ EN mapping_rules' THEN 3 ELSE 4 END, razon_catalina;
