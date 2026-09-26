/**
 * OCR text of real supplier dockets, exactly as Tesseract read them from phone photos in
 * the test bench. Regression fixtures: the parser must keep getting these right.
 */
export const REAL_DOCKETS = [
  {
    id: 'bega-daily-delivery-docket',
    // Every product row, in order. The docket's own layout: a column-headings row, then
    // one row per product (some wrap onto a second line), then "Total weight".
    products: [
      'Pura Milk 2Lt Bottle',
      'Pura Light Start 2Lt Bottle',
      'Dairy Choice Whole Milk 2L HDPE Bottle',
      'Dare Double Espresso 750ml BTL (6)',
      'Dare Espresso 500ml BTL (6)',
      'Dare Mocha 500ml BTL (6)',
      'DF ESL Heart Active 1L (12)',
      'FUnion Natrl Greek Style Yogurt 1kg (6)',
      'DF Protein Smoothie Choc 400mL BTL',
      'DF Protein Smoothie Banana Hny 400mL (6)',
    ],
    lines: [
      'C8        Ll 2         2.            e                                                                            1',
      'fA ho',
      'ROUTE TRANSPORT                                                               ved',
      '|                                                     DAILY DELIVERY DOCKET (PGI)         =                                   LX',
      'Metro Petroleum Truganina                                                             BDD Australia 5        NDS VIC 8012                     =',
      '2        211 Leakes Rd                                                                        PO Box 23084, DOCKLA                                    4',
      'f         TRUGANINA 3029                                General Enquiries:                1800 000 570                                                  3',
      '!                                                                     Customer Portal:                   mybega.begagroup-com-at                                  3',
      '-                                                                     Credit Services:                     creanservcesS0BES                           2',
      ':          Delivery Date              23/09/2026           Wednesday       Route           MELO11                                                             | ,',
      'Customer #:                256582                                        Trip Code:  TR896087                                                          or',
      'Customer PO #:            PO_256582_230926                        Sales Order: 0121921865                                                          E',
      'PEER.  Fmd Zoi           Product Description          Ordered Picked  Delivered     hes',
      '0827408699          2        0 3024|EA EA | Pura Milk 2Lt Bottle                             18 els             j     3',
      '0827408699          1        0 3278|EA EA | Pura Light Start 2Lt Bottle                        oj  ;',
      '0827408699           2         0 5366|EA EA | Dairy Choice Whole Milk 2L HDPE                 18 18                   24',
      'Bottle                                                        |               an Wy, 5',
      '0827408699           il         0 7774|EA EA | Dare Double Espresso 750ml BTL (6)               6     rl                    | |',
      '0827408699          1        0 7768|EA EA | Dare Espresso 500ml BTL (6)                      6   _-6|',
      '0827408699         1        0 7770|EA EA | Dare Mocha 500ml BTL (6)                      6 —5j',
      '0827408699           0         2 4155|EA EA | DF ESL Heart Active 1L (12)                         21',
      '0827408699        0       2 1141[EA EA | FUnion Natrl Greek Style Yogurt 1kg (6) 2 —2',
      '0827408699 2         10 4907|EA EA | DF Protein Smoothie Choc 400mL BTL          |                     |',
      '0827408699           1         0 4908|EA EA | DF Protein Smoothie Banana Hny           6     —6',
      '400mL (6)                                       §',
      '11] 4             |                                                     |          85 85',
      'Total weight (KG):                  120.06',
      '|',
    ],
  },
];
