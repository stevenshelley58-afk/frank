<?php
return [
    'name' => 'Frank Owner Entry',
    'description' => 'Fixed native owner workspace SAML return',
    'version' => '1.0.0',
    'routes' => [
        'main' => [
            'mautic_frank_owner_session' => [
                'path' => '/s/frank/session',
                'controller' => 'FrankOwnerEntryBundle:Entry:sessionAction',
            ],
            'mautic_frank_owner_return' => [
                'path' => '/s/frank/return',
                'controller' => 'FrankOwnerEntryBundle:Entry:returnAction',
            ],
        ],
    ],
];
