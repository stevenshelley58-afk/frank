<?php
return [
    'name' => 'Frank Owner Entry',
    'description' => 'Fixed native owner workspace SAML return',
    'version' => '1.0.0',
    'routes' => [
        'main' => [
            'mautic_frank_owner_session' => [
                'path' => '/frank/session',
                'controller' => 'MauticPlugin\\FrankOwnerEntryBundle\\Controller\\EntryController::sessionAction',
            ],
            'mautic_frank_owner_return' => [
                'path' => '/frank/return',
                'controller' => 'MauticPlugin\\FrankOwnerEntryBundle\\Controller\\EntryController::returnAction',
            ],
        ],
    ],
];
