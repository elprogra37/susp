/**
 * Bancos de texto para el proveedor determinístico.
 *
 * Español rioplatense, porque es el mercado de las apps que SUSP puebla. No
 * pretende competir con un modelo: pretende ser **plausible, variado y
 * reproducible**, que es lo que hace falta para llenar una demo o correr una
 * prueba de carga sin gastar un centavo en tokens.
 */

export const NOMBRES_F = [
  'Camila', 'Sofía', 'Valentina', 'Martina', 'Lucía', 'Julieta', 'Micaela',
  'Agustina', 'Florencia', 'Rocío', 'Brenda', 'Malena', 'Paula', 'Carla',
  'Antonella', 'Milagros', 'Guadalupe', 'Ayelén', 'Delfina', 'Renata',
] as const;

export const NOMBRES_M = [
  'Mateo', 'Santiago', 'Joaquín', 'Bautista', 'Tomás', 'Lautaro', 'Facundo',
  'Nicolás', 'Franco', 'Ignacio', 'Emiliano', 'Thiago', 'Gonzalo', 'Ramiro',
  'Bruno', 'Julián', 'Máximo', 'Dante', 'Iván', 'Lucas',
] as const;

export const NOMBRES_X = [
  'Ariel', 'Alex', 'Renzo', 'Noa', 'Cris', 'Sasha', 'Andrea', 'Guada',
] as const;

export const APELLIDOS = [
  'González', 'Rodríguez', 'Fernández', 'López', 'Martínez', 'Pérez', 'Gómez',
  'Sánchez', 'Romero', 'Díaz', 'Álvarez', 'Torres', 'Ruiz', 'Ramírez',
  'Flores', 'Benítez', 'Acosta', 'Medina', 'Herrera', 'Aguirre', 'Ferreyra',
  'Sosa', 'Giménez', 'Molina', 'Ortiz', 'Silva', 'Rojas', 'Castro',
] as const;

export const CIUDADES = [
  { city: 'Buenos Aires', country: 'AR', lat: -34.6, lon: -58.38 },
  { city: 'Rosario', country: 'AR', lat: -32.95, lon: -60.66 },
  { city: 'Córdoba', country: 'AR', lat: -31.42, lon: -64.18 },
  { city: 'Mendoza', country: 'AR', lat: -32.89, lon: -68.84 },
  { city: 'La Plata', country: 'AR', lat: -34.92, lon: -57.95 },
  { city: 'Mar del Plata', country: 'AR', lat: -38.0, lon: -57.55 },
  { city: 'Salta', country: 'AR', lat: -24.79, lon: -65.41 },
  { city: 'Neuquén', country: 'AR', lat: -38.95, lon: -68.06 },
  { city: 'Bariloche', country: 'AR', lat: -41.13, lon: -71.31 },
  { city: 'Tucumán', country: 'AR', lat: -26.82, lon: -65.22 },
] as const;

export const INTERESES = [
  'fotografía', 'cine', 'ciclismo', 'cocina', 'running', 'música en vivo',
  'literatura', 'senderismo', 'jardinería', 'ajedrez', 'yoga', 'escalada',
  'vinos', 'series', 'podcasts', 'ilustración', 'natación', 'básquet',
  'fútbol', 'teatro', 'huerta', 'carpintería', 'videojuegos', 'astronomía',
  'mate en la plaza', 'ferias de barrio', 'cerámica', 'idiomas',
] as const;

export const PROFESIONES = [
  'diseñadora gráfica', 'programador', 'docente', 'enfermera', 'contador',
  'arquitecta', 'kinesiólogo', 'periodista', 'chef', 'ingeniera',
  'fotógrafa', 'músico', 'abogada', 'comerciante', 'psicóloga', 'electricista',
] as const;

/** Fragmentos de biografía, para combinar sin que suenen todas iguales. */
export const BIO_APERTURAS = [
  'Soy {profesion}.',
  '{profesion}, de {ciudad}.',
  'Trabajo de {profesion} hace unos años.',
  'De {ciudad}, {profesion}.',
] as const;

export const BIO_GUSTOS = [
  'Me pierdo con {interes} y {interes2}.',
  'Los fines de semana: {interes}.',
  'Fan de {interes}, aprendiendo {interes2}.',
  'Si hay {interes} de por medio, cuenten conmigo.',
  '{interes} desde siempre; {interes2} desde hace poco.',
] as const;

export const BIO_CIERRES = [
  'Café antes que hablar.',
  'Mejor de noche.',
  'Siempre con un libro a mano.',
  'Pregunto mucho.',
  'Puntual, obsesivamente.',
  'Mejor plan: caminar sin rumbo.',
  'Cocino mejor de lo que canto.',
  'Vivo con dos gatos.',
] as const;

// ──────────────────────────── contenido por vertical ────────────────────────────

export const POSTS_SOCIAL = [
  'Salí a caminar sin rumbo y terminé en {ciudad}. A veces conviene no tener plan.',
  'Alguien más piensa que {interes} es la mejor forma de cortar la semana?',
  'Tres años haciendo {interes} y recién ahora entiendo lo básico.',
  'Recomiendo fuerte: arrancar el día con {interes}. Cambia todo.',
  'Hoy aprendí que ser {profesion} es 20% saber y 80% explicar lo que sabés.',
  'Encontré una feria en {ciudad} que no conocía. Vuelvo el finde.',
  'Pregunta seria: se puede hacer {interes} sin gastar una fortuna?',
  'Después de un día largo, {interes}. Innegociable.',
  'Me pasaron un dato de {interes} que me voló la cabeza. Lo dejo abajo.',
  'Nadie avisa que {profesion} implica tanto papeleo.',
] as const;

export const POSTS_DATING = [
  'Busco a alguien para {interes} sin agenda ni apuro.',
  'Plan ideal: {interes} y después cocinar algo tranquilo.',
  'Si te gusta {interes}, ya tenemos de qué hablar.',
  'Prefiero una charla larga a mil mensajes cortos.',
  'De {ciudad}. Cero drama, mucho {interes}.',
  'Puedo hablar de {interes} durante horas. Aviso a tiempo.',
] as const;

export const POSTS_MARKETPLACE = [
  'Vendo {objeto}, poco uso, en {ciudad}. Escuchá ofertas.',
  '{objeto} impecable. Lo tengo hace un año y lo usé tres veces.',
  'Liquido {objeto} por mudanza. Entrega en {ciudad}.',
  'Cambio {objeto} por algo de {interes}. Escucho propuestas.',
  '{objeto} nuevo, sin abrir. Me lo regalaron repetido.',
] as const;

export const OBJETOS = [
  'una bici rodado 29', 'un teclado mecánico', 'una cámara réflex',
  'un par de zapatillas de running', 'una mesa de madera maciza',
  'una consola con dos joysticks', 'un juego de ollas', 'una guitarra criolla',
  'una notebook de 14 pulgadas', 'una carpa para tres personas',
] as const;

export const POSTS_TELEMEDICINA = [
  'Consulta: hace tres días tengo {sintoma}. Es para preocuparse?',
  'Buenas, quería una consulta de control. Me toca chequeo anual.',
  'Vengo con {sintoma} desde el fin de semana. Adjunto estudios previos.',
  'Necesito renovar una receta. La última fue hace tres meses.',
  'Después del tratamiento mejoré bastante, pero sigo con {sintoma} leve.',
] as const;

export const SINTOMAS = [
  'dolor de cabeza a la tarde', 'tos seca', 'cansancio', 'molestia en la rodilla',
  'insomnio', 'dolor de garganta', 'mareos al levantarme', 'acidez',
] as const;

// ──────────────────────────── mensajería ────────────────────────────

export const MENSAJES_APERTURA = [
  'Hola! Vi que también te gusta {interes}.',
  'Buenas! Cómo va?',
  'Hola, qué tal? Vi tu perfil y me copó.',
  'Che, hacés {interes}? Yo estoy arrancando.',
  'Hola! Sos de {ciudad}?',
] as const;

export const MENSAJES_SEGUIMIENTO = [
  'Buenísimo. Y hace cuánto?',
  'Ah mirá, no sabía. Contame más.',
  'Jaja tal cual. A mí me pasa igual.',
  'Y qué recomendás para arrancar?',
  'Me sumo cuando quieras.',
  'Dale, cualquier cosa avisame.',
  'Totalmente de acuerdo.',
  'No lo había pensado así.',
] as const;

export const COMENTARIOS = [
  'Buenísimo!',
  'Coincido totalmente.',
  'Tremendo.',
  'Justo estaba pensando lo mismo.',
  'Contá más!',
  'Jaja me pasó igual.',
  'Gracias por compartir.',
  'Anotado.',
  'No sabía esto.',
  'Te leo siempre.',
] as const;

/** Muletillas que se agregan según la personalidad, no al azar. */
export const MULETILLAS_INFORMALES = ['che', 'posta', 'la verdad', 'obvio'] as const;
export const CIERRES_FORMALES = [
  'Saludos cordiales.',
  'Quedo a disposición.',
  'Muchas gracias.',
] as const;
