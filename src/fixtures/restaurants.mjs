export const restaurantFixtures = [
  {
    slug: 'jw-steakhouse-berlin',
    name: 'JW Steakhouse Berlin',
    website: 'https://www.jwsteakhouseberlin.com/our-menus',
    city: 'Berlin',
    country: 'Germany',
    bookingUrl: 'https://www.opentable.com/restaurant/profile/271461/reserve?restref=271461',
    notes: [
      'Official HTML menu page plus direct food PDF on the same domain.',
      'Useful validation target for HTML menu discovery and OpenTable booking detection.',
    ],
    knownMenuUrls: [
      'https://www.jwsteakhouseberlin.com/our-menus',
      'https://www.jwsteakhouseberlin.com/resourcefiles/pdf/jw-food-menu.pdf',
    ],
  },
  {
    slug: 'mina-berlin',
    name: 'MINA Berlin',
    website: 'https://minaberlin.de/en/',
    city: 'Berlin',
    country: 'Germany',
    bookingUrl: 'https://www.sevenrooms.com',
    notes: [
      'Official restaurant site exposes multiple PDF menus from the same landing page.',
      'Useful validation target for PDF classification and SevenRooms booking detection.',
    ],
    knownMenuUrls: [
      'https://minaberlin.de/en/',
      'https://minaberlin.de/upload/Mina_Menu_Berlin_290x385_29_08_en.pdf',
    ],
  },
  {
    slug: 'the-roof-milano',
    name: 'The Roof Milano',
    website: 'https://www.theroofmilano.com/en',
    city: 'Milan',
    country: 'Italy',
    bookingUrl: 'https://theroofmilano.superbexperience.com/',
    notes: [
      'Official restaurant site plus official menu PDF on the operator domain.',
      'Useful validation target for PDF menu extraction and booking-engine detection.',
    ],
    knownMenuUrls: [
      'https://www.theroofmilano.com/en',
      'https://www.deicavaliericollection.com/images/documents/The_Roof_Milano_-_Restaurant_Menu_New1.pdf',
    ],
  },
];

export function getRestaurantFixture(slug) {
  return restaurantFixtures.find((restaurant) => restaurant.slug === slug) ?? restaurantFixtures[0];
}
